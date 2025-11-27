import React from 'react';
// Index (app bootstrap): mounts React app into DOM
import { createRoot } from 'react-dom/client';
import App from './App';
import SinglePageLanding from './SinglePageLanding';
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

const isSingle = process.env.REACT_APP_SINGLE_PAGE === 'true';

root.render(
	<React.StrictMode>
		{isSingle ? <SinglePageLanding /> : <App />}
	</React.StrictMode>
);
