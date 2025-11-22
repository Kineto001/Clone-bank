import os
import json
import random
import math
import time
from flask import Flask, request, jsonify, render_template
import google.generativeai as genai
from dotenv import load_dotenv
import re

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='static')

# --- CONFIGURATION ---
SOURCE_MATERIAL_FOLDER = "source_material"
SUBJECT_MAPPING = {
    "Quantitative Aptitude": "quantitative_aptitude",
    "Quantitative Aptitude (Additional)": "quantitative_aptitude_additional",
    "Reasoning Ability": "reasoning_ability",
    "English Language": "english_language"
}

# --- GEMINI API SETUP ---
try:
    gemini_api_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY not found in environment variables.")
    genai.configure(api_key=gemini_api_key)
    
    # CHANGED: Using 'gemini-1.5-flash' for significantly faster generation speed
    model = genai.GenerativeModel('gemini-2.5-pro')
    print("Gemini API configured successfully (Model: gemini-2.5-pro).")
except Exception as e:
    print(f"Error configuring Gemini API: {e}")
    model = None

# --- HELPER FUNCTIONS ---
def clean_gemini_json_response(response_text):
    """
    Cleans the Gemini response to extract a valid JSON string.
    """
    response_text = response_text.replace("```json", "").replace("```", "").strip()
    match = re.search(r'\[.*\]', response_text, re.DOTALL)
    if match:
        json_str = match.group(0)
    else:
        print("Warning: No outermost JSON array found. Returning original cleaned text.")
        json_str = response_text

    json_str = json_str.replace("$$", "").replace("$", "")
    json_str = json_str.replace("\\(", "").replace("\\)", "")
    json_str = json_str.replace("\\[", "").replace("\\]", "")
    json_str = re.sub(r'Here are the questions in JSON format:?\n*', '', json_str, flags=re.IGNORECASE)
    json_str = re.sub(r'\n*Please find the questions below in JSON format\.?\n*', '', json_str, flags=re.IGNORECASE)
    json_str = re.sub(r'\n*\[START JSON\]\n*', '', json_str, flags=re.IGNORECASE)
    json_str = re.sub(r'\n*\[END JSON\]\n*', '', json_str, flags=re.IGNORECASE)

    return json_str.strip()


# --- PROMPT TEMPLATES ---
PROMPT_TEMPLATE = """
You are an expert Bank Exam (IBPS, SBI PO/Clerk level) question creator. Your task is to generate {num_questions} high-quality multiple-choice questions (MCQs) for the topic: '{topic}'.

**Source Context:**
\"\"\"
{context}
\"\"\"

**INSTRUCTIONS:**
1.  **OUTPUT:** Strict JSON array of objects. No markdown, no intro text.
2.  **FORMAT:**
    [
      {{
        "question": "Question text here...",
        "options": ["Option A", "Option B", "Option C", "Option D"],
        "correct_answer_index": 0,
        "explanation": "Explanation here..."
      }}
    ]
3.  **NO LATEX:** Use plain text for math.
4.  **DIFFICULTY:** Competitive exam level.

Generate exactly {num_questions} questions now.
"""

FALLBACK_PROMPT_TEMPLATE = """
Generate {num_questions} MCQs for Bank Exams on '{topic}'.
Output STRICT JSON array only.
Structure: {{"question": "...", "options": ["A","B","C","D"], "correct_answer_index": 0, "explanation": "..."}}
No Markdown. No LaTeX.
"""

def generate_questions_for_topic(prompt_details):
    num_questions = prompt_details['num_questions']
    topic = prompt_details['topic']
    context = prompt_details['context']

    if num_questions <= 0:
        return []

    for attempt in range(2): 
        prompt_to_use = PROMPT_TEMPLATE if attempt == 0 else FALLBACK_PROMPT_TEMPLATE
        prompt = prompt_to_use.format(num_questions=num_questions, topic=topic, context=context)

        try:
            response_obj = model.generate_content(prompt)
            raw_response_text = response_obj.text
            cleaned_json_str = clean_gemini_json_response(raw_response_text)
            questions = json.loads(cleaned_json_str)
            
            if isinstance(questions, list) and len(questions) > 0:
                for q in questions:
                    q['topic'] = topic
                return questions
        except Exception as e:
            print(f"Attempt {attempt+1} failed for '{topic}': {e}")

        time.sleep(1) # Reduced sleep time since Flash is faster

    return []

# --- API ENDPOINTS ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/get-structure', methods=['GET'])
def get_structure():
    structure = {}
    if not os.path.isdir(SOURCE_MATERIAL_FOLDER):
        return jsonify({"error": f"Base folder '{SOURCE_MATERIAL_FOLDER}' not found."}), 404
    
    for subject_key, subject_folder in SUBJECT_MAPPING.items():
        subject_path = os.path.join(SOURCE_MATERIAL_FOLDER, subject_folder)
        if os.path.isdir(subject_path):
            topics = [f.replace('.txt', '') for f in os.listdir(subject_path) if f.endswith('.txt') and os.path.isfile(os.path.join(subject_path, f))]
            if topics:
                structure[subject_key] = {"Topics": sorted(topics)}
    return jsonify(structure)

@app.route('/api/generate-test', methods=['POST'])
def generate_test():
    if not model:
        return jsonify({"error": "Gemini API is not configured."}), 500
    data = request.json
    subject = data.get('subject')
    topic = data.get('topic')
    num_questions = int(data.get('num_questions', 10))
    test_type = data.get('test_type', 'topic-wise')

    context_text = "No specific context provided."
    
    subject_folder = None
    if subject:
        for key, value in SUBJECT_MAPPING.items():
            if key.lower() == subject.lower():
                subject_folder = value
                break

    context_available = False
    if subject_folder and topic:
        try:
            file_path = os.path.join(SOURCE_MATERIAL_FOLDER, subject_folder, f"{topic}.txt")
            if os.path.exists(file_path):
                with open(file_path, 'r', encoding='utf-8') as f:
                    context_text = f.read()
                context_available = True
        except Exception:
            pass

    all_questions = []
    
    if test_type == 'topic-wise' and context_available:
        num_from_context = math.ceil(num_questions * 0.7)
        num_from_general = num_questions - num_from_context
        
        if num_from_context > 0:
            all_questions.extend(generate_questions_for_topic({
                'num_questions': num_from_context, 'topic': topic, 'context': context_text
            }))
        if num_from_general > 0:
            all_questions.extend(generate_questions_for_topic({
                'num_questions': num_from_general, 'topic': topic, 
                'context': "General knowledge based."
            }))
    else:
        all_questions = generate_questions_for_topic({
            'num_questions': num_questions, 'topic': topic, 'context': context_text
        })
        
    random.shuffle(all_questions)
    if not all_questions:
        return jsonify({"error": f"Failed to generate questions for '{topic}'."}), 500
    
    return jsonify(all_questions)

@app.route('/api/chat-support', methods=['POST'])
def chat_support():
    if not model:
        return jsonify({"error": "Gemini API is not configured."}), 500
    data = request.json
    user_query = data.get('user_query')
    question_text = data.get('question_text')
    topic = data.get('topic', 'General')

    try:
        prompt = f"""
        Provide a hint for this Bank Exam question without revealing the answer.
        Q: "{question_text}"
        Student asks: "{user_query}"
        """
        response = model.generate_content(prompt)
        return jsonify({"reply": response.text})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    if not os.path.exists(SOURCE_MATERIAL_FOLDER):
        os.makedirs(SOURCE_MATERIAL_FOLDER)
    app.run(host='0.0.0.0', port=8080)
