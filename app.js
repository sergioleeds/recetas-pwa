/**
 * Recipe PWA Logic with Firebase
 */

// FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyAWkNsE_4bCe5tYo5lGE1EhLwcdJx13YlY",
    authDomain: "recetasapp-8bf73.firebaseapp.com",
    projectId: "recetasapp-8bf73",
    storageBucket: "recetasapp-8bf73.firebasestorage.app",
    messagingSenderId: "1011672375916",
    appId: "1:1011672375916:web:a59ff471751648e8b72e49"
};

// Initialize Firebase (Compat)
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// STATE
let state = {
    user: null, // User object if logged in
    recipes: [], // Loaded from LocalStorage OR Firestore
    pantry: [], // { name, quantity, unit }
    selectedRecipeIds: new Set(),
    view: 'list'
};

// DOM ELEMENTS
const views = {
    list: document.getElementById('view-list'),
    add: document.getElementById('view-add'),
    list: document.getElementById('view-list'),
    add: document.getElementById('view-add'),
    shopping: document.getElementById('view-shopping'),
    pantry: document.getElementById('view-pantry')
};

const containers = {
    recipeList: document.getElementById('recipe-list-container'),
    ingredientsList: document.getElementById('ingredients-list'),
    ingredientsList: document.getElementById('ingredients-list'),
    shoppingListItems: document.getElementById('shopping-list-items'),
    shoppingConfirmItems: document.getElementById('shopping-confirm-items'),
    pantryList: document.getElementById('pantry-list')
};

const ui = {
    generateBtn: document.getElementById('btn-generate-shop'),
    selectedCount: document.getElementById('selected-count'),
    shopRecipeCount: document.getElementById('shop-recipe-count'),
    pantryBtn: document.getElementById('btn-pantry'),
    shoppingModeView: document.getElementById('shopping-mode-view'),
    shoppingModeComplete: document.getElementById('shopping-mode-complete'),
    pageTitle: document.getElementById('page-title'),
    backBtn: document.getElementById('header-action-btn'),
    loginBtn: document.getElementById('btn-login'),
    userName: document.getElementById('user-name')
};

// UTILS
const uuid = () => Date.now().toString(36) + Math.random().toString(36).substr(2);

// DATA LAYER
const loadData = async () => {
    state.selectedRecipeIds.clear();

    if (state.user) {
        // Cloud Mode
        ui.userName.textContent = state.user.displayName.split(' ')[0];
        ui.userName.classList.remove('hidden');
        ui.loginBtn.textContent = 'Salir';

        const snapshot = await db.collection('users').doc(state.user.uid).collection('recipes').get();
        state.recipes = snapshot.docs.map(doc => doc.data());

        // SYNC: If cloud is empty but local has data, offer upload
        const localData = JSON.parse(localStorage.getItem('recipes') || '[]');
        if (state.recipes.length === 0 && localData.length > 0) {
            if (confirm(`Tienes ${localData.length} recetas locales. ¿Subirlas a tu cuenta?`)) {
                await uploadLocalToCloud(localData);
                return; // upload will reload
            }
        }

        // Load Pantry
        const pantrySnap = await db.collection('users').doc(state.user.uid).collection('pantry').get();
        state.pantry = pantrySnap.docs.map(doc => doc.data());

    } else {
        // Local Mode
        ui.userName.classList.add('hidden');
        ui.loginBtn.textContent = 'Login Google';
        state.recipes = JSON.parse(localStorage.getItem('recipes') || '[]');
        state.pantry = JSON.parse(localStorage.getItem('pantry') || '[]');
    }

    renderRecipeList();
};

const saveData = async () => {
    if (state.user) {
        // We're saving state.recipes to Firestore. 
        // NOTE: For efficiency, we usually update singular docs, but for this simple app,
        // we will simple ensure the NEWEST recipe is added or DELETED recipe is removed.
        // For simplicity in this function, we assume individual CRUD actions handle the DB calls.
        // This function 'saveData' might not be needed for Cloud mode if we treat DB calls directly.
    } else {
        localStorage.setItem('recipes', JSON.stringify(state.recipes));
        localStorage.setItem('pantry', JSON.stringify(state.pantry));
    }
};

const uploadLocalToCloud = async (localRecipes) => {
    console.log("Iniciando subida...", localRecipes);
    const batch = db.batch();
    const userRef = db.collection('users').doc(state.user.uid).collection('recipes');

    localRecipes.forEach(recipe => {
        const docRef = userRef.doc(recipe.id);
        batch.set(docRef, recipe);
    });

    try {
        console.log("Ejecutando batch commit...");
        await batch.commit();
        console.log("Batch commit exitoso");
        alert('¡Recetas sincronizadas con la nube correctamente!');
        // Clear local storage to prevent duplicate prompts and switching back to local mode
        localStorage.removeItem('recipes');
        loadData();
    } catch (error) {
        console.error("Error en batch commit:", error);
        alert('Error subiendo recetas: ' + error.message);
    }
};

// AUTH
ui.loginBtn.onclick = () => {
    if (state.user) {
        auth.signOut();
    } else {
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider)
            .then(() => {
                // Auth state listener will handle the rest
                console.log("Login exitoso");
            })
            .catch(err => alert("Error login: " + err.message));
    }
};

// Removed getRedirectResult as we are using popup now

auth.onAuthStateChanged(user => {
    state.user = user;
    loadData();
});

// NAVIGATION
const navigate = (viewName) => {
    state.view = viewName;
    Object.values(views).forEach(el => el.classList.remove('active'));
    views[viewName].classList.add('active');

    if (viewName === 'list') {
        ui.pageTitle.textContent = 'Mis Recetas';
        ui.backBtn.classList.add('hidden');
        renderRecipeList();
    } else if (viewName === 'add') {
        ui.pageTitle.textContent = 'Nueva Receta';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('list');
        resetForm();
    } else if (viewName === 'shopping') {
        ui.pageTitle.textContent = 'Lista de Compra';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('list');
        renderShoppingList();
    } else if (viewName === 'pantry') {
        ui.pageTitle.textContent = 'Mi Despensa';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('list');
        renderPantry();
    }
};

// CORE DISPLAY LOGIC
const renderRecipeList = () => {
    containers.recipeList.innerHTML = '';

    if (state.recipes.length === 0) {
        containers.recipeList.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 40px; color: #888;">
                <p>No tienes recetas ${state.user ? 'en la nube' : 'guardadas'}.</p>
                <div style="display: flex; gap: 10px; justify-content: center; flex-direction: column;">
                    <button onclick="navigate('add')" class="btn">Crear nueva</button>
                    <button onclick="window.parseCSVAndSeed()" class="btn btn-secondary">📥 Cargar Recetas Pack Inicial</button>
                </div>
            </div>`;
        ui.generateBtn.style.display = 'none';
        return;
    }

    state.recipes.forEach(recipe => {
        const div = document.createElement('div');
        div.className = `recipe-card ${state.selectedRecipeIds.has(recipe.id) ? 'selected' : ''}`;
        div.onclick = (e) => toggleSelection(recipe.id, div, e);

        div.innerHTML = `
            <div class="checkbox-wrapper">
                <input type="checkbox" ${state.selectedRecipeIds.has(recipe.id) ? 'checked' : ''} style="pointer-events: none;">
            </div>
            <div style="flex:1">
                <h3 style="margin:0; font-size: 1.1rem;">${recipe.name}</h3>
                <p class="text-muted" style="margin: 5px 0 0 0;">${recipe.ingredients.length} ingredientes</p>
            </div>
            <button class="btn btn-danger btn-icon" onclick="deleteRecipe('${recipe.id}', event)">🗑️</button>
        `;
        containers.recipeList.appendChild(div);
    });

    updateSelectionUI();
};

const toggleSelection = (id, cardEl, event) => {
    if (event && event.target.tagName === 'BUTTON') return;
    if (state.selectedRecipeIds.has(id)) {
        state.selectedRecipeIds.delete(id);
        cardEl.classList.remove('selected');
        cardEl.querySelector('input').checked = false;
    } else {
        state.selectedRecipeIds.add(id);
        cardEl.classList.add('selected');
        cardEl.querySelector('input').checked = true;
    }
    updateSelectionUI();
};

const updateSelectionUI = () => {
    const count = state.selectedRecipeIds.size;
    ui.selectedCount.textContent = count;
    ui.generateBtn.style.display = count > 0 ? 'block' : 'none';
};

const deleteRecipe = async (id, event) => {
    event.stopPropagation();
    if (!confirm('¿Eliminar receta?')) return;

    // Optimistic UI update
    state.recipes = state.recipes.filter(r => r.id !== id);
    state.selectedRecipeIds.delete(id);
    renderRecipeList();

    if (state.user) {
        await db.collection('users').doc(state.user.uid).collection('recipes').doc(id).delete();
    } else {
        saveData();
    }
};

// ADD RECIPE
const addIngredientRow = () => {
    const div = document.createElement('div');
    div.className = 'ingredient-row';
    div.innerHTML = `
        <input type="text" placeholder="Ingrediente" class="ing-name">
        <input type="number" placeholder="Cant." class="ing-qty">
        <input type="text" placeholder="Unid." class="ing-unit">
        <button class="btn btn-danger btn-icon" onclick="this.parentElement.remove()">×</button>
    `;
    containers.ingredientsList.appendChild(div);
};

const resetForm = () => {
    document.getElementById('recipe-name').value = '';
    containers.ingredientsList.innerHTML = '';
    addIngredientRow();
};

const saveRecipe = async () => {
    const name = document.getElementById('recipe-name').value.trim();
    if (!name) return alert('Ponle un nombre a la receta!');

    const rows = Array.from(containers.ingredientsList.querySelectorAll('.ingredient-row'));
    const ingredients = rows.map(row => ({
        name: row.querySelector('.ing-name').value.trim(),
        quantity: parseFloat(row.querySelector('.ing-qty').value) || 0,
        unit: row.querySelector('.ing-unit').value.trim()
    })).filter(ing => ing.name);

    if (ingredients.length === 0) return alert('Añade al menos un ingrediente.');

    const newRecipe = {
        id: uuid(),
        name,
        ingredients,
        createdAt: Date.now()
    };

    // Optimistic
    state.recipes.push(newRecipe);
    navigate('list');

    if (state.user) {
        await db.collection('users').doc(state.user.uid).collection('recipes').doc(newRecipe.id).set(newRecipe);
    } else {
        saveData();
    }
};

// SHOPPING LIST
const renderShoppingList = () => {
    containers.shoppingListItems.innerHTML = '';
    ui.shopRecipeCount.textContent = state.selectedRecipeIds.size;

    const aggregated = {};
    state.selectedRecipeIds.forEach(id => {
        const recipe = state.recipes.find(r => r.id === id);
        if (!recipe) return;
        recipe.ingredients.forEach(ing => {
            const key = `${ing.name.toLowerCase()}_${ing.unit.toLowerCase()}`;
            if (!aggregated[key]) {
                aggregated[key] = { name: ing.name, unit: ing.unit, quantity: 0 };
            }
            aggregated[key].quantity += ing.quantity;
        });
    });

    const sortedKeys = Object.keys(aggregated).sort();

    if (sortedKeys.length === 0) {
        containers.shoppingListItems.innerHTML = '<p style="text-align:center; padding:20px;">Nada que comprar.</p>';
        return;
    }

    sortedKeys.forEach(key => {
        const item = aggregated[key];
        const div = document.createElement('div');
        div.className = 'shopping-item';
        div.innerHTML = `
            <span style="font-weight:500;">${item.name}</span>
            <span class="text-muted">${item.quantity} ${item.unit}</span>
        `;
        containers.shoppingListItems.appendChild(div);
    });
};

const startPurchase = () => {
    ui.shoppingModeView.classList.add('hidden');
    ui.shoppingModeComplete.classList.remove('hidden');

    // Generate confirm list
    containers.shoppingConfirmItems.innerHTML = '';
    const aggregated = getAggregatedShoppingList();

    Object.keys(aggregated).sort().forEach(key => {
        const item = aggregated[key];
        const div = document.createElement('div');
        div.className = 'confirm-row';
        div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; padding-bottom:10px; border-bottom:1px solid #eee;';
        div.innerHTML = `
            <div style="flex:1">
                <div style="font-weight:500;">${item.name}</div>
                <div class="text-muted" style="font-size:0.8rem">Necesario: ${item.quantity} ${item.unit}</div>
            </div>
            <div style="flex:0 0 100px; text-align:right;">
                <input type="number" class="confirm-qty" data-key="${key}" value="${item.quantity}" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px;">
                <div style="font-size:0.8rem; color:#888; text-align:right;">Comprado (${item.unit})</div>
            </div>
        `;
        containers.shoppingConfirmItems.appendChild(div);
    });
};

const cancelPurchase = () => {
    ui.shoppingModeView.classList.remove('hidden');
    ui.shoppingModeComplete.classList.add('hidden');
};

const confirmPurchase = async () => {
    if (!confirm("¿Confirmar compra y actualizar despensa?")) return;

    const aggregated = getAggregatedShoppingList();
    const inputs = document.querySelectorAll('.confirm-qty');
    const today = Date.now();

    const batch = state.user ? db.batch() : null;

    inputs.forEach(input => {
        const key = input.dataset.key;
        const boughtQty = parseFloat(input.value) || 0;
        const neededQty = aggregated[key].quantity;
        const item = aggregated[key];

        if (boughtQty > neededQty) {
            const leftover = boughtQty - neededQty;
            const pantryItem = {
                id: uuid(), // New ID for pantry item
                name: item.name,
                quantity: leftover,
                unit: item.unit,
                updatedAt: today
            };

            // Check if exists in pantry (simple check by name+unit)
            const existingIdx = state.pantry.findIndex(p => p.name.toLowerCase() === item.name.toLowerCase() && p.unit.toLowerCase() === item.unit.toLowerCase());

            if (existingIdx >= 0) {
                // Update existing
                state.pantry[existingIdx].quantity += leftover;
                state.pantry[existingIdx].updatedAt = today;
                if (state.user) {
                    const ref = db.collection('users').doc(state.user.uid).collection('pantry').doc(state.pantry[existingIdx].id);
                    batch.update(ref, state.pantry[existingIdx]);
                }
            } else {
                // Add new
                state.pantry.push(pantryItem);
                if (state.user) {
                    const ref = db.collection('users').doc(state.user.uid).collection('pantry').doc(pantryItem.id);
                    batch.set(ref, pantryItem);
                }
            }
        }
    });

    if (state.user) {
        await batch.commit();
    } else {
        saveData();
    }

    alert('¡Compra registrada! Lo que sobró está en tu despensa.');

    // Reset selection? Maybe keep it or clear it. Lets clear it.
    state.selectedRecipeIds.clear();
    cancelPurchase(); // Return to view mode (which will be empty now)
    navigate('pantry'); // Go to pantry to see results
};

const getAggregatedShoppingList = () => {
    const aggregated = {};
    state.selectedRecipeIds.forEach(id => {
        const recipe = state.recipes.find(r => r.id === id);
        if (!recipe) return;
        recipe.ingredients.forEach(ing => {
            const key = `${ing.name.toLowerCase()}_${ing.unit.toLowerCase()}`;
            if (!aggregated[key]) {
                aggregated[key] = { name: ing.name, unit: ing.unit, quantity: 0 };
            }
            aggregated[key].quantity += ing.quantity;
        });
    });
    return aggregated;
};


// PANTRY
const renderPantry = () => {
    containers.pantryList.innerHTML = '';
    if (state.pantry.length === 0) {
        containers.pantryList.innerHTML = '<p class="text-center text-muted">Tu despensa está vacía.</p>';
        return;
    }

    state.pantry.forEach(item => {
        const div = document.createElement('div');
        div.className = 'shopping-item'; // Reuse style
        div.innerHTML = `
            <span style="font-weight:500;">${item.name}</span>
            <span class="text-muted">${item.quantity} ${item.unit}</span>
            <button class="btn btn-sm btn-danger" style="margin-left:auto; padding: 2px 8px;" onclick="deletePantryItem('${item.id}')">×</button>
        `;
        containers.pantryList.appendChild(div);
    });
};

const deletePantryItem = async (id) => {
    if (!confirm("¿Borrar ingrediente?")) return;
    state.pantry = state.pantry.filter(p => p.id !== id);
    renderPantry();

    if (state.user) {
        await db.collection('users').doc(state.user.uid).collection('pantry').doc(id).delete();
    } else {
        saveData();
    }
};

// EVENT LISTENERS
document.getElementById('btn-add-recipe').onclick = () => navigate('add');
document.getElementById('btn-cancel-add').onclick = () => navigate('list');
document.getElementById('btn-add-ingredient').onclick = addIngredientRow;
document.getElementById('btn-save-recipe').onclick = saveRecipe;
document.getElementById('btn-generate-shop').onclick = () => navigate('shopping');
document.getElementById('btn-back-list').onclick = () => navigate('list');
document.getElementById('btn-pantry').onclick = () => navigate('pantry');
document.getElementById('btn-start-purchase').onclick = startPurchase;
document.getElementById('btn-cancel-purchase').onclick = cancelPurchase;
document.getElementById('btn-confirm-purchase').onclick = confirmPurchase;

// REGISTER SERVICE WORKER
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registered'))
            .catch(err => console.log('SW failed', err));
    });
}
