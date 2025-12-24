// This is an inline worker script. 
// We use this pattern to ensure it works in Obsidian without separate file loading issues.

export const WORKER_CODE = `
  self.onmessage = function(e) {
    const { id, text } = e.data;
    
    // Hash function to detect changes
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
        const char = text.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    const hashStr = hash.toString();

    // Perform word count logic
    // Credit: better-word-count by Luke Leppan (https://github.com/lukeleppan/better-word-count)
    let words = 0;
    const matches = text.match(
        /[a-zA-Z0-9_\\u0392-\\u03c9\\u00c0-\\u00ff\\u0600-\\u06ff]+|[\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\u3040-\\u309f\\uac00-\\ud7af]+/gm
    );

    if (matches) {
        for (let i = 0; i < matches.length; i++) {
            if (matches[i].charCodeAt(0) > 19968) {
                words += matches[i].length;
            } else {
                words += 1;
            }
        }
    }

    // Send back the result with the same ID
    self.postMessage({ id, count: words, hash: hashStr });
  };
`;
