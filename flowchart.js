import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs';

let initialized = false;

/**
 * Initialize Mermaid ONCE
 */
export function initMermaid() {
    if (initialized) return;

    mermaid.initialize({
        theme: 'neutral',
        flowchart: {
            htmlLabels: true,
            useMaxWidth: false,
        },
    });

    initialized = true;
}

/**
 * Render ONCE only
 */
export async function renderFlowchart() {
    const container = document.getElementById('mermaid-container');
    if (!container) return;

    await mermaid.run({
        nodes: container.querySelectorAll('.mermaid')
    });
}