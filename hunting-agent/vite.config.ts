import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Pre-bundle the graph libraries at startup. They're imported only by the Lab 10/11
	// knowledge-graph view, so without this Vite discovers them mid-session the first time those
	// labs open and re-optimizes dependencies — which forces a full reload and (on an unsupported
	// Node) has been crashing the dev server. Optimizing them upfront removes that mid-session churn.
	optimizeDeps: {
		include: ['cytoscape', 'cytoscape-fcose']
	}
});
