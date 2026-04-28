# 🛒 KiranaAI - Multilingual WhatsApp Inventory Bot

KiranaAI is a smart inventory management assistant designed for small shop owners (Kirana shops) in India. It allows shopkeepers to manage their stock levels using simple WhatsApp messages in their preferred local language.

<div align="center">
  <img src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" alt="KiranaAI Banner" width="100%">
</div>

## ✨ How It Works

KiranaAI leverages state-of-the-art AI to simplify complex inventory tasks:

1.  **WhatsApp Interface**: Shopkeepers send a message like "10 sabun aaya" (Hindi) or "5 biscuit becha" (Telugu).
2.  **Gemini AI Processing**: The message is processed by Google's **Gemini 3 Flash** model, which:
    *   Detects the language (English, Hindi, Telugu).
    *   Identifies the intent (ADD, SELL, or QUERY).
    *   Extracts item names and quantities (even handling spelling mistakes).
    *   Generates a polite confirmation reply in the same language.
3.  **Firebase Firestore**: The parsed data is automatically synchronized with a real-time Firestore database.
4.  **Instant Reply**: The shopkeeper receives a WhatsApp confirmation with updated stock totals.

## 🚀 Features

*   **Multilingual Support**: Fully understands and responds in **Hindi**, **Telugu**, and **English**.
*   **Intelligent Parsing**: Understands natural language (e.g., "stok dikhao", "sabun khatam ho gaya").
*   **Real-time Inventory**: Tracks stock ins and outs instantly.
*   **Transaction Logs**: Maintains a history of all activity for audits.
*   **Spelling Tolerance**: AI-driven matching handles varied spellings of item names.

## 🛠️ Tech Stack

*   **Runtime**: Node.js (TypeScript)
*   **AI**: Google Gemini 3 Flash (via `@google/genai`)
*   **Database**: Firebase Firestore
*   **Messaging**: WhatsApp Cloud API (Meta)
*   **Server**: Express.js
*   **Tooling**: `tsx` for execution, `dotenv` for configuration

## 📦 Setup & Installation

### Prerequisites
*   Node.js (v18+)
*   A Meta Developer account with WhatsApp Cloud API configured
*   A Firebase project with Firestore enabled
*   A Gemini API Key from [Google AI Studio](https://aistudio.google.com/)

### Installation

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/vishnu0496/Kirana-AI.git
    cd Kirana-AI
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    Create a `.env` file based on `.env.example`:
    ```env
    GEMINI_API_KEY="your_key"
    WHATSAPP_TOKEN="your_meta_token"
    WHATSAPP_PHONE_NUMBER_ID="your_phone_id"
    WHATSAPP_VERIFY_TOKEN="your_secret_verify_token"
    ```

4.  **Firebase Config**:
    Add your `firebase-applet-config.json` to the root directory.

5.  **Run the Server**:
    ```bash
    npm run dev
    ```

6.  **Webhook Setup**:
    Point your WhatsApp Webhook to `https://your-server-url/api/webhook/whatsapp`.

## 📜 License
MIT
