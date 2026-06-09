#!/usr/bin/env bash

# Installation script for real-time monitoring dashboard

set -e

echo "🚀 Installing dashboard dependencies..."

# Backend dependencies
cd backend
echo "📦 Installing backend dependencies..."
npm install

# Frontend dependencies
cd ../frontend
echo "📦 Installing frontend dependencies..."
npm install

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 Next steps:"
echo "1. Start the backend: cd backend && npm run dev"
echo "2. Start the frontend: cd frontend && npm run dev"
echo "3. Open http://localhost:5173 in your browser"
echo "4. Login as admin and navigate to 'Monitor' to view the dashboard"
echo ""
echo "📊 Dashboard features:"
echo "  • Real-time metrics via WebSocket (or 30s polling fallback)"
echo "  • 4 key metrics: Request rate, Error rate, Active users, Latency p95"
echo "  • Live log stream with severity filtering"
echo "  • Time-series chart for last 60 minutes"
echo "  • Mobile-responsive layout"
