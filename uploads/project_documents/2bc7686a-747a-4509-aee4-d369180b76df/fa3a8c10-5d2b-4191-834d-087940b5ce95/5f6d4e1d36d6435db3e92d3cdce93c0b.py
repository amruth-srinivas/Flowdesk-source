import pdfplumber
import re
import sys
import json
import os
import google.generativeai as genai

# Configure your API Key
API_KEY = os.environ.get("GEMINI_API_KEY", "AIzaSyDXirKE7cy_ZAvPSUhWonQY2VSHnDXLZac") 

if API_KEY:
    genai.configure(api_key=API_KEY)
else:
    print("Warning: GEMINI_API_KEY environment variable not set. Vision fallback will fail.")

def clean_text(text):
    if text:
        # Replace newlines and multiple spaces
        text = str(text).replace('\n', ' ').replace('\r', '')
        return re.sub(r'\s+', ' ', text).strip()
    return None

def is_pdf_scanned(pdf_path, text_threshold=50):
    """
    Determine if a PDF is likely scanned by checking the amount of extractable text.
    Returns True if scanned (or text is very sparse), False otherwise.
    """
    extracted_text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            # Check up to first 3 pages for text
            for page in pdf.pages[:3]:
                text = page.extract_text()
                if text:
                    extracted_text += text
    except Exception as e:
         print(f"Error reading PDF with pdfplumber: {e}")
         return True # Assume scanned or corrupted if we can't read it
    
    # If the total extracted text is very short, it's likely a scan or mostly images
    if len(extracted_text.strip()) < text_threshold:
        return True
    return False


def extract_data_from_pdf_plumber(pdf_path):
    print(f"Extracting text using pdfplumber: {pdf_path}")
    extracted_items = []
    # Global metadata to be applied to all items
    global_metadata = {
        "Drawing Number": None,
        "Project Number": None,
        "Notes": None
    }

    try:
        with pdfplumber.open(pdf_path) as pdf:
            first_page = pdf.pages[0]
            
            # 1. Table Extraction
            tables = first_page.extract_tables()
            
            if tables:
                for table in tables:
                    header_found = False
                    header_indices = {}
                    
                    # First pass: Locate Header
                    for r_idx, row in enumerate(table):
                        bind_row = [str(cell).strip().upper() if cell else "" for cell in row]
                        
                        # Heuristic for header row
                        if "DESCRIPTION" in bind_row and ("MATERIAL" in bind_row or "QTY" in bind_row or "QTY." in bind_row):
                            header_found = True
                            try:
                                header_indices["desc"] = bind_row.index("DESCRIPTION")
                                if "MATERIAL" in bind_row: 
                                    header_indices["mat"] = bind_row.index("MATERIAL")
                                
                                # Looser match for others
                                for i, cell in enumerate(bind_row):
                                    if "QTY" in cell: header_indices["qty"] = i
                                    if "MASS" in cell: header_indices["mass"] = i
                                    if "REMARK" in cell: header_indices["remark"] = i
                                    if "PART" in cell and "NO" in cell: header_indices["part"] = i
                            except ValueError:
                                pass
                            
                            # Once header is found, extract items from THIS table using these indices
                            # We scan ALL rows (above and below) except the header itself
                            for data_r_idx, data_row in enumerate(table):
                                if data_r_idx == r_idx: continue # Skip header
                                
                                # Check if row has valid data
                                # Must have a Part Number or Description to be valid
                                current_item = {}
                                
                                # Extract Part No
                                if "part" in header_indices and header_indices["part"] < len(data_row):
                                    raw_part = clean_text(data_row[header_indices["part"]])
                                    if raw_part and raw_part.upper() not in ["PART NO", "PART"]:
                                        # VALIDATION: Part Number must start with a digit or '*'
                                        if raw_part[0].isdigit() or raw_part.startswith('*'):
                                            current_item["Part No"] = raw_part
                                
                                # Extract Description
                                if "desc" in header_indices and header_indices["desc"] < len(data_row):
                                    raw_desc = clean_text(data_row[header_indices["desc"]])
                                    if raw_desc and raw_desc.upper() != "DESCRIPTION":
                                        current_item["Description"] = raw_desc
                                
                                if not current_item.get("Part No") and not current_item.get("Description"):
                                    continue # Skip empty/irrelevant rows

                                # Extract other fields
                                if "mat" in header_indices and header_indices["mat"] < len(data_row):
                                    current_item["Material"] = clean_text(data_row[header_indices["mat"]])
                                if "qty" in header_indices and header_indices["qty"] < len(data_row):
                                    current_item["Qty"] = clean_text(data_row[header_indices["qty"]])
                                if "mass" in header_indices and header_indices["mass"] < len(data_row):
                                    current_item["Mass"] = clean_text(data_row[header_indices["mass"]])
                                if "remark" in header_indices and header_indices["remark"] < len(data_row):
                                    current_item["Remark"] = clean_text(data_row[header_indices["remark"]])
                                
                                # Ensure all keys exist for consistency
                                for key in ["Part No", "Description", "Material", "Qty", "Mass", "Remark"]:
                                    if key not in current_item: current_item[key] = None
                                
                                # Filter out likely junk rows
                                if current_item:
                                    extracted_items.append(current_item)
                            
                            break # Assume only one BOM per table
                            
                    # Second pass: Look for Global Info in ALL rows
                    for row in table:
                        clean_row = [str(cell).strip() if cell else "" for cell in row]
                        for c_idx, cell in enumerate(clean_row):
                            if not cell: continue
                            
                            # Drawing Number search
                            if "DRAWING NO" in cell.upper() or "DWG NO" in cell.upper():
                                lines = cell.split('\n')
                                for line in lines:
                                    clean_line = line.strip()
                                    if clean_line.upper().replace(".","").replace(" ","") in ["DRAWINGNO", "DWGNO"]: continue
                                    if len(clean_line) > 3: global_metadata["Drawing Number"] = clean_line
                                
                                if not global_metadata["Drawing Number"] and c_idx + 1 < len(row):
                                    val = clean_text(row[c_idx+1])
                                    if val and len(val) > 2: global_metadata["Drawing Number"] = val

                            # Project Number search
                            if "PROJECT" in cell.upper():
                                match = re.search(r"PROJECT\s*NO\.?\s*(.+)", cell, re.IGNORECASE)
                                found_in_cell = False
                                if match:
                                    val = clean_text(match.group(1))
                                    if val and len(val) > 1: 
                                        global_metadata["Project Number"] = val
                                        found_in_cell = True
                                
                                if not found_in_cell:
                                    for look_ahead in range(1, 5):
                                        if c_idx + look_ahead < len(row):
                                            val = clean_text(row[c_idx + look_ahead])
                                            if val and len(val) > 1:
                                                global_metadata["Project Number"] = val
                                                break

            # Fallback for globals: Regex on generic text
            text = first_page.extract_text() or ""
            if not global_metadata["Project Number"]:
                 m = re.search(r"Project\s*No\.?[:\s]*([A-Za-z0-9\-\.]+)", text, re.IGNORECASE)
                 if m:
                    val = clean_text(m.group(1))
                    if val and len(val) > 1: global_metadata["Project Number"] = val

            if not global_metadata["Drawing Number"]:
                 m = re.search(r"Drawing\s*No\.?[:\s]*([A-Za-z0-9\-\.]+)", text, re.IGNORECASE)
                 if m: 
                    val = clean_text(m.group(1))
                    if val and len(val) > 3: global_metadata["Drawing Number"] = val
                 if not global_metadata["Drawing Number"]:
                     m = re.search(r"(D-cm-\d+-\d+)", text)
                     if m: 
                        val = clean_text(m.group(1))
                        if val and len(val) > 3: global_metadata["Drawing Number"] = val
                        
            # EXTRACT NOTES
            if not global_metadata["Notes"]:
                 regex_pattern = r"NOTES\s*:(.+?)(?=(?:SECTION|PART\s*(?:No\.?|NO)\s*DESCRIPTION|PART\s*(?:No\.?|NO)\s*MATERIAL)|$)"
                 notes_match = re.search(regex_pattern, text, re.IGNORECASE | re.DOTALL)
                 if notes_match:
                     raw_notes = notes_match.group(1).strip()
                     cleaned_notes = re.sub(r'\s+', ' ', raw_notes).strip()
                     
                     if "PART DESCRIPTION" in cleaned_notes.upper():
                         cut_index = cleaned_notes.upper().index("PART DESCRIPTION")
                         cleaned_notes = cleaned_notes[:cut_index].strip()
                     
                     if extracted_items:
                         first_part = extracted_items[0]
                         p_no = first_part.get("Part No", "")
                         p_desc = first_part.get("Description", "")
                         if p_no and p_desc:
                             check_str = f"{p_no} {p_desc[:5]}"
                             if check_str in cleaned_notes:
                                 cut_index = cleaned_notes.index(check_str)
                                 cleaned_notes = cleaned_notes[:cut_index].strip()
                             else:
                                 if len(p_desc) > 5 and p_desc in cleaned_notes:
                                      cut_index = cleaned_notes.index(p_desc)
                                      cleaned_notes = cleaned_notes[:cut_index].strip()
                                      if cleaned_notes.strip().endswith(p_no):
                                          cleaned_notes = cleaned_notes.strip()[:-len(p_no)].strip()

                     cleaned_notes = re.sub(r'(?<!\d)(\d+\.)', r'\n\1', cleaned_notes).strip()
                     global_metadata["Notes"] = cleaned_notes
                     
            if not extracted_items:
                single_item = {}
                m = re.search(r"Part\s*No\.?[:\s]*([A-Za-z0-9\-\.]+)", text, re.IGNORECASE)
                if m: single_item["Part No"] = clean_text(m.group(1))
                if single_item: extracted_items.append(single_item)

    except Exception as e:
        return {"error": str(e)}

    # Construct final output
    final_output = {
        "Global Metadata": global_metadata,
        "Parts": extracted_items
    }
    return final_output


def extract_data_from_pdf_vision(pdf_path):
    print(f"Uploading '{pdf_path}' to Gemini Vision API (Scanned PDF detected)...")
    if not API_KEY:
         return {"error": "GEMINI_API_KEY environment variable not set. Cannot use vision extraction."}
         
    try:
        # Upload the PDF file to the Gemini File API
        pdf_file = genai.upload_file(path=pdf_path, mime_type="application/pdf")
        
        # Initialize the model 
        model = genai.GenerativeModel('gemini-2.5-flash')
        
        # Define the precise prompt and JSON schema
        prompt = """
        You are an expert at reading mechanical engineering drawings. 
        Extract the Bill of Materials (BOM) table and the global metadata from the provided drawing.
        
        CRITICAL EXTRACTION RULES:
        1. STRICT COLUMN SEPARATION: Do not combine columns. If a part has a material specified (e.g., "CLASS 12.9", "17-4 PH", "B26SWP"), it MUST go into the "Material" field, not the "Description" field. 
        2. EXACT CHARACTER TRANSCRIPTION: Pay microscopic attention to letters and numbers in poor-quality scans. Double-check prefixes and material codes.
        3. COMPLETE METADATA: Ensure the global drawing number includes any trailing revision numbers or trailing zeroes at the end of the text block.
        4. EMPTY CELLS: If a column (like Mass or Material) is visually empty for a specific part, output null for that field.
        5. PART NO. vs DESCRIPTION ALIGNMENT: The very first column is "PART No.", and the second column is "DESCRIPTION". In some rows, the "PART No." column is completely empty, and the text (like "R-102-102-00", "B-126-001-00-7.5MM BALANCE") is strictly in the "DESCRIPTION" column. If the cell under "PART No." is empty for a row, set "Part No" to null (or empty string) and put the text in the "Description" field. Do NOT shift the description into the "Part No" field.

        Respond ONLY with a valid JSON object matching this exact structure:
        {
            "Global Metadata": {
                "Drawing Number": "string or null",
                "Project Number": "string or null",
                "Notes": "string or null"
            },
            "Parts": [
                {
                    "Part No": "string or null",
                    "Description": "string or null",
                    "Material": "string or null",
                    "Qty": "string or null",
                    "Mass": "string or null",
                    "Remark": "string or null"
                }
            ]
        }
        """
        
        print("Analyzing drawing and extracting structured data with Vision model...")
        
        # Generate content, forcing the output to be strictly JSON
        response = model.generate_content(
            [pdf_file, prompt],
            generation_config={"response_mime_type": "application/json"}
        )
        
        # Clean up the file from Google's servers after processing
        genai.delete_file(pdf_file.name)
        
        # Return the parsed JSON dictionary
        return json.loads(response.text)

    except Exception as e:
        return {"error": str(e)}


def process_pdf(pdf_path):
    """
    Main orchestrator that decides which extraction method to use.
    """
    print(f"Analyzing PDF: {pdf_path}")
    if is_pdf_scanned(pdf_path):
        print("-> PDF appears to be a scanned document or image-based.")
        return extract_data_from_pdf_vision(pdf_path)
    else:
        print("-> PDF appears to be text-based, using layout analysis.")
        # We can still fallback to vision if plumber fails or returns no tables 
        # but for now we'll just run plumber
        plumber_result = extract_data_from_pdf_plumber(pdf_path)
        
        # Optional: Fallback logic if plumber found zero parts 
        # (Meaning it was a vector PDF but drawing lines were used instead of structured text tables)
        if not plumber_result.get("error") and not plumber_result.get("Parts"):
             print("-> Layout analysis found no data. Falling back to Vision model.")
             return extract_data_from_pdf_vision(pdf_path)
             
        return plumber_result


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except AttributeError:
        pass # Python < 3.7 or generic stream
        
    if len(sys.argv) < 2:
        print("Usage: python combined.py <pdf_file>")
        sys.exit(1)

    pdf_file = sys.argv[1]
    if not os.path.exists(pdf_file):
        print(f"Error: File '{pdf_file}' not found.")
        sys.exit(1)

    # Process based on content type
    result = process_pdf(pdf_file)
    
    # Print to console
    print(json.dumps(result, indent=4))
    
    # Save to file
    output_filename = "extracted_data_combined.json"
    with open(output_filename, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=4)
    print(f"\nOutput saved to {output_filename}")
