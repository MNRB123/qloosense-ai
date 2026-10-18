# QlooSense AI

An AI-powered discovery application using Qloo taste intelligence to explore personalized experiences.

## Project Status

- Express and TypeScript backend
- Qloo API integration configured
- Health check endpoint: `/api/health`
- Location-based recommendations: `/api/recommendations`
- Dietary preference verification remains in progress

## Requirements

- Node.js 20 or newer
- npm

## Local Setup

1. Install dependencies:

   `npm install`

2. Copy `.env.example` to `.env`.
3. Add your authorized Qloo API key to `.env`.
4. Start the development server:

   `npm run dev`

5. Check the health endpoint at `http://localhost:3000/api/health`.

## Environment Variables

- `QLOO_API_KEY` — your authorized Qloo API key
- `QLOO_BASE_URL` — Qloo API base URL
- `PORT` — server port; defaults to 3000

## Build

`npm run build`

## Security

Never commit `.env`, API keys, or private user data. Dietary attributes must not be presented as verified without reliable evidence for the individual entity.

## Hackathon

Developed for the Qloo Agentic Hackathon to explore personalized discovery experiences.
