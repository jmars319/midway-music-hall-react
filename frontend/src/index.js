import React from 'react';
// Index (app bootstrap): mounts React app into DOM
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

/*
	Entry point (frontend) - minimal bootstrap

	Developer notes:
	- This file mounts the React app into the DOM. Keep it minimal. For
		development you can wrap <App /> with additional providers (Router,
		QueryClientProvider, ThemeProvider) if needed. Creating a small file
		like this keeps the entry predictable for test harnesses and SSR.
*/
const rootElement = document.getElementById('root');
const root = createRoot(rootElement);

root.render(
	<React.StrictMode>
		<App />
	</React.StrictMode>
);
