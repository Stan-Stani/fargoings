# Fargoings - Fargo Event Aggregator

A Node.js/TypeScript event aggregator that fetches and stores events from Fargo-Moorhead area sources.

## Features

- Fetches events from fargomoorhead.org API
- **Dynamic token fetching** - Automatically retrieves and caches API tokens (valid for 24 hours)
- Stores events in SQLite database
- Prevents duplicates with upsert logic
- TypeScript for type safety

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run the aggregator:
```bash
npm start
```

## Scripts

- `npm start` - Run the event aggregator
- `npm run dev` - Run in watch mode
- `npm run build` - Build TypeScript to JavaScript

## Database Schema

Events are stored with the following fields:
- Event ID, title, URL
- Location, city, coordinates
- Start/end dates
- Categories
- Image URL
- Source

## Adding More Sources

To add additional event sources:

1. Create a new fetcher in `src/fetchers/`
2. Implement the fetch and transform methods
3. Update `src/index.ts` to include the new source

## How It Works

### Dynamic Token Fetching

The Fargo Moorhead API requires a token that expires after 24 hours. Instead of manually managing tokens, this aggregator:

1. Automatically fetches a fresh token from `https://www.fargomoorhead.org/plugins/core/get_simple_token/`
2. Caches the token in memory for 23 hours (with 1 hour buffer)
3. Automatically refreshes the token when it expires

This means no manual token management is required!
