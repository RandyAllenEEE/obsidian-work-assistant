const fs = require('fs');
const path = require('path');

const iconsDir = path.join(__dirname, '../node_modules/qweather-icons/icons');
const outputFile = path.join(__dirname, '../src/weather/qweatherIcons.ts');

const files = fs.readdirSync(iconsDir);

let output = 'export const QWeatherIcons: Record<string, string> = {\n';

let count = 0;
files.forEach(file => {
    // Match "100.svg", "101.svg", "200.svg" ... (numerical codes)
    // We also include 999, etc.
    // QWeather codes are typically 3-4 digits.
    if (/^\d+\.svg$/.test(file)) {
        const code = file.replace('.svg', '');
        const content = fs.readFileSync(path.join(iconsDir, file), 'utf8');
        // Remove newlines and potentially minify slightly
        const cleanContent = content.replace(/\r?\n|\r/g, '').replace(/>\s+</g, '><').trim();

        // Escape backticks if any (SVGs usually don't have them, but safe practice)
        // SVG fits inside a template string
        output += `  "${code}": \`${cleanContent}\`,\n`;
        count++;
    }
});

output += '};\n';

fs.writeFileSync(outputFile, output);
console.log(`Generated ${outputFile} with ${count} icons.`);
