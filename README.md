# Hermes Mini – Intelligent Telegram Assistant for Daily Task Management

## Project Introduction

Hermes Mini is an intelligent Persian-language assistant on Telegram, developed using artificial intelligence and Cloudflare serverless technologies.

Users can manage their daily tasks through ordinary Persian messages without using special commands.

## Main Features

- Adding new tasks using Persian messages
- Displaying the task list
- Marking tasks as completed
- Changing completed tasks back to pending
- Deleting tasks
- Searching for tasks
- Editing tasks by title or number
- Displaying specific tasks by number
- Supporting reminders and daily summaries

## Technologies Used

- **Cloudflare Workers:** Running the application using a serverless architecture
- **Cloudflare Workers AI:** Processing Persian messages using artificial intelligence
- **Cloudflare D1:** Storing user information and tasks
- **Telegram Bot API:** Communicating with users through Telegram
- **JavaScript:** Main programming language
- **Wrangler:** Development and deployment tool

## Project Structure

```text
hermes_mini/
├── migrations/
│   ├── 0001_create_tasks_table.sql
│   └── 0002_add_reminders_and_memory.sql
├── src/
│   └── index.js
├── test/
│   └── index.spec.js
├── package.json
├── wrangler.jsonc
└── README.md
```

## Project Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Cloudflare

The Worker, D1 database, and Workers AI bindings are configured in the `wrangler.jsonc` file.

### 3. Configure Secret Information

The Telegram bot token and other sensitive information must be configured using Cloudflare Secrets. These values must never be committed to the GitHub repository.

### 4. Run the Application Locally

```bash
npm run dev
```

### 5. Deploy to Cloudflare

```bash
npm run deploy
```

## Security

- Access is restricted to the authorized user.
- Webhook requests are verified using a secret key.
- Sensitive information is securely stored in Cloudflare.
- AI responses are checked and validated before any operation is performed.

## Project Links

**GitHub Repository:**

https://github.com/lyzohani13-oss/hermes_mini

**Worker URL:**

https://hermes-mini.hermes-mini-tasks.workers.dev

## Project Goal

The goal of Hermes Mini is to develop an intelligent Persian-language assistant for daily task management by combining serverless architecture, natural language processing, and cloud-based data storage.

**Project Name:** Hermes Mini  
**Programming Language:** JavaScript  
**Platform:** Cloudflare Workers
