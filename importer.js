// Importador CSV interactivo (formato: name,ingredients o columnas por ingrediente)

(function () {
    const btn = document.getElementById('btn-import-csv');
    const input = document.getElementById('file-import');

    if (!btn || !input) return;

    btn.addEventListener('click', () => {
        // Verificar login antes de abrir el selector
        if (!auth || !auth.currentUser) {
            alert('Debes iniciar sesión con Google para importar recetas.');
            document.getElementById('btn-login')?.click();
            return;
        }
        input.click();
    });

    input.addEventListener('change', async (ev) => {
        const file = ev.target.files && ev.target.files[0];
        if (!file) return;
        
        // Verificar que hay usuario logueado
        if (!auth.currentUser) {
            alert('Debes iniciar sesión para importar recetas.');
            input.value = '';
            return;
        }
        
        try {
            const text = await file.text();
            const recipes = detectAndParseCSV(text);
            
            // Guardar en Firestore con el UID del usuario
            const uid = auth.currentUser.uid;
            const col = db.collection('users').doc(uid).collection('recipes');
            
            for (const r of recipes) {
                const recipeData = {
                    ...r,
                    id: 'imported-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
                    updatedAt: Date.now(),
                    createdAt: Date.now()
                };
                await col.doc(recipeData.id).set(recipeData);
            }
            
            alert(`✅ Importadas ${recipes.length} recetas.`);
            input.value = '';
            
            // Recargar datos desde Firestore
            if (typeof loadData === 'function') {
                await loadData();
            } else {
                location.reload();
            }
        } catch (e) {
            console.error(e);
            alert('❌ Error al importar el archivo CSV: ' + e.message);
        }
    });

    // Detectar formato y parsear
    function detectAndParseCSV(csvText) {
        const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        if (lines.length === 0) throw new Error('CSV vacío');
        
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Formato 1: name,ingredients
        if (headers.includes('name') && headers.includes('ingredients')) {
            return parseSimpleCSV(csvText);
        }
        
        // Formato 2: columnas por ingrediente (tiene "Number", "Name", etc)
        if (headers.includes('number') || headers.length > 10) {
            return parseColumnCSV(csvText);
        }
        
        // Default: formato simple
        return parseSimpleCSV(csvText);
    }

    // Formato simple: name,ingredients
    function parseSimpleCSV(csvText) {
        const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const nameIdx = headers.indexOf('name');
        const ingIdx = headers.indexOf('ingredients');
        
        if (nameIdx < 0) throw new Error('CSV debe tener columna "name"');
        
        const out = [];
        for (let i = 1; i < lines.length; i++) {
            const cols = splitCSVLine(lines[i]);
            const name = cols[nameIdx] ? cols[nameIdx].replace(/^"|"$/g, '').trim() : ('Receta ' + i);
            const ingRaw = cols[ingIdx] ? cols[ingIdx].replace(/^"|"$/g, '').trim() : '';
            const ingredients = ingRaw ? ingRaw.split('|').map(it => {
                const parts = it.split(':');
                return { 
                    name: (parts[0] || '').trim(), 
                    quantity: parseFloat(parts[1]) || 0, 
                    unit: (parts[2] || '').trim() 
                };
            }).filter(x => x.name) : [];
            
            if (ingredients.length > 0) {
                out.push({ name, ingredients });
            }
        }
        return out;
    }

    // Formato columnas (como el CSV inicial del proyecto)
    function parseColumnCSV(csvText) {
        const lines = csvText.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const ingredientHeaders = headers.slice(3).filter(h => h);
        const recipes = [];

        const parseMeta = (header) => {
            const match = header.match(/(.*)\s\((.*)\)/);
            if (match) return { name: match[1].trim(), unit: match[2].trim() };
            return { name: header, unit: 'units' };
        };

        for (let i = 1; i < lines.length; i++) {
            let row = [];
            let inQuote = false, buffer = '';
            for (let char of lines[i]) {
                if (char === '"') { inQuote = !inQuote; continue; }
                if (char === ',' && !inQuote) { row.push(buffer); buffer = ''; continue; }
                buffer += char;
            }
            row.push(buffer);

            if (row.length < 3) continue;
            const name = row[1];
            const ingredients = [];

            for (let j = 0; j < ingredientHeaders.length; j++) {
                const rawValue = row[j + 3];
                if (rawValue && rawValue.trim() !== '') {
                    const header = ingredientHeaders[j];
                    const meta = parseMeta(header);
                    ingredients.push({
                        name: meta.name,
                        quantity: parseFloat(rawValue.trim()),
                        unit: meta.unit
                    });
                }
            }

            if (ingredients.length > 0) {
                recipes.push({ name, ingredients });
            }
        }
        return recipes;
    }

    function splitCSVLine(line) {
        const res = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (ch === '"') { inQuotes = !inQuotes; continue; }
            if (ch === ',' && !inQuotes) { res.push(cur); cur = ''; continue; }
            cur += ch;
        }
        res.push(cur);
        return res.map(s => s.trim());
    }
})();
