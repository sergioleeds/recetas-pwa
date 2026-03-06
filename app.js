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
try {
    firebase.initializeApp(firebaseConfig);
    console.log('Firebase initialized successfully');
    
    // Configurar persistencia de auth
    firebase.auth().setPersistence(firebase.auth.Auth.Persistence.LOCAL)
        .then(() => console.log('Auth persistence set'))
        .catch(e => console.error('Persistence error:', e));
} catch (e) {
    console.error('Firebase init error:', e);
}
const auth = firebase.auth();
const db = firebase.firestore();

// STATE
let state = {
    user: null, // User object if logged in
    recipes: [], // Loaded from LocalStorage OR Firestore
    pantry: [], // { name, quantity, unit }
    history: [], // Shopping list history: { id, date, recipeIds, recipeNames, items: [] }
    nutritionCache: {}, // Cache for nutrition data: { ingredientName: { calories, protein, carbs, fat, per100g } }
    selectedRecipeIds: new Set(),
    selectedPurchase: null, // Temporary storage for purchase being added to pantry
    editingRecipeId: null, // ID of recipe being edited (null = creating new)
    view: 'list'
};

// DOM ELEMENTS
const views = {
    list: document.getElementById('view-list'),
    add: document.getElementById('view-add'),
    shopping: document.getElementById('view-shopping'),
    pantry: document.getElementById('view-pantry'),
    addPantry: document.getElementById('view-add-pantry'),
    history: document.getElementById('view-history'),
    selectPurchase: document.getElementById('view-select-purchase'),
    confirmPurchaseAdd: document.getElementById('view-confirm-purchase-add')
};

const containers = {
    recipeList: document.getElementById('recipe-list-container'),
    ingredientsList: document.getElementById('ingredients-list'),
    shoppingListItems: document.getElementById('shopping-list-items'),
    shoppingConfirmItems: document.getElementById('shopping-confirm-items'),
    pantryList: document.getElementById('pantry-list'),
    historyList: document.getElementById('history-list'),
    purchaseSelectionList: document.getElementById('purchase-selection-list'),
    purchaseItemsAdjust: document.getElementById('purchase-items-adjust')
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

// NUTRITION API (Open Food Facts)
const getNutritionData = async (ingredientName) => {
    const key = ingredientName.toLowerCase().trim();
    
    // Check cache first
    if (state.nutritionCache[key]) {
        console.log('Nutrition: Using cached data for', key);
        return state.nutritionCache[key];
    }
    
    try {
        console.log('Nutrition: Fetching from API for', key);
        // Search Open Food Facts API
        const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(key)}&search_simple=1&json=1&page_size=5`;
        const response = await fetch(searchUrl);
        const data = await response.json();
        
        if (data.products && data.products.length > 0) {
            // Get first product with nutriments
            const product = data.products.find(p => p.nutriments && p.nutriments.energy_100g);
            
            if (product && product.nutriments) {
                const nutritionData = {
                    calories: Math.round(product.nutriments['energy-kcal_100g'] || product.nutriments.energy_100g / 4.184 || 0),
                    protein: parseFloat(product.nutriments.proteins_100g || 0).toFixed(1),
                    carbs: parseFloat(product.nutriments.carbohydrates_100g || 0).toFixed(1),
                    fat: parseFloat(product.nutriments.fat_100g || 0).toFixed(1),
                    per100g: true
                };
                
                // Save to cache
                state.nutritionCache[key] = nutritionData;
                saveNutritionCache();
                
                console.log('Nutrition: Found data', nutritionData);
                return nutritionData;
            }
        }
        
        console.log('Nutrition: No data found for', key);
        return null;
    } catch (error) {
        console.error('Nutrition API error:', error);
        return null;
    }
};

const saveNutritionCache = async () => {
    if (state.user) {
        // Save to Firestore
        try {
            await db.collection('users').doc(state.user.uid).collection('settings').doc('nutritionCache').set({
                cache: state.nutritionCache,
                updatedAt: Date.now()
            });
        } catch (error) {
            console.error('Error saving nutrition cache to Firebase:', error);
        }
    } else {
        // Save to localStorage
        localStorage.setItem('nutritionCache', JSON.stringify(state.nutritionCache));
    }
};

const calculateRecipeNutrition = async (ingredients) => {
    let totalCalories = 0;
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    let foundCount = 0;
    
    for (const ing of ingredients) {
        const nutritionData = await getNutritionData(ing.name);
        if (nutritionData) {
            // Calculate based on quantity (assuming per 100g)
            const factor = ing.quantity / 100;
            totalCalories += nutritionData.calories * factor;
            totalProtein += parseFloat(nutritionData.protein) * factor;
            totalCarbs += parseFloat(nutritionData.carbs) * factor;
            totalFat += parseFloat(nutritionData.fat) * factor;
            foundCount++;
        }
    }
    
    if (foundCount === 0) return null;
    
    return {
        calories: Math.round(totalCalories),
        protein: totalProtein.toFixed(1),
        carbs: totalCarbs.toFixed(1),
        fat: totalFat.toFixed(1),
        dataAvailable: foundCount,
        totalIngredients: ingredients.length
    };
};

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
        if (localData.length > 0) {
            // Find truly new recipes (not duplicates by name)
            const cloudNames = new Set(state.recipes.map(r => r.name.toLowerCase().trim()));
            const newRecipes = localData.filter(r => !cloudNames.has(r.name.toLowerCase().trim()));
            
            if (newRecipes.length > 0) {
                const recipeNames = newRecipes.map(r => r.name).join(', ');
                if (confirm(`Tienes ${newRecipes.length} receta(s) local(es) nueva(s): ${recipeNames}\n\n¿Subirlas a tu cuenta?`)) {
                    await uploadLocalToCloud(newRecipes);
                    return; // upload will reload
                }
            } else if (localData.length > 0) {
                // All local recipes already exist in cloud, just clean up localStorage
                console.log('Local recipes already exist in cloud, cleaning localStorage');
                localStorage.removeItem('recipes');
            }
        }

        // Load Pantry
        const pantrySnap = await db.collection('users').doc(state.user.uid).collection('pantry').get();
        state.pantry = pantrySnap.docs.map(doc => doc.data());

        // Load History
        const historySnap = await db.collection('users').doc(state.user.uid).collection('history').orderBy('date', 'desc').get();
        state.history = historySnap.docs.map(doc => doc.data());
        
        // Load Nutrition Cache
        const cacheSnap = await db.collection('users').doc(state.user.uid).collection('settings').doc('nutritionCache').get();
        if (cacheSnap.exists) {
            state.nutritionCache = cacheSnap.data().cache || {};
        }
        
        console.log('Loaded from Firebase:', {
            recipes: state.recipes.length,
            pantry: state.pantry.length,
            history: state.history.length,
            nutritionCache: Object.keys(state.nutritionCache).length
        });

    } else {
        // No user logged in - load from localStorage
        ui.userName.classList.add('hidden');
        ui.loginBtn.textContent = 'G';
        state.recipes = JSON.parse(localStorage.getItem('recipes') || '[]');
        state.pantry = JSON.parse(localStorage.getItem('pantry') || '[]');
        state.history = JSON.parse(localStorage.getItem('history') || '[]');
        state.nutritionCache = JSON.parse(localStorage.getItem('nutritionCache') || '{}');
        console.log('Loaded from localStorage:', {
            recipes: state.recipes.length,
            pantry: state.pantry.length,
            history: state.history.length,
            nutritionCache: Object.keys(state.nutritionCache).length
        });
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
        localStorage.setItem('history', JSON.stringify(state.history));
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
        if (confirm('¿Cerrar sesión?')) {
            auth.signOut();
        }
    } else {
        console.log('Iniciando login...');
        const provider = new firebase.auth.GoogleAuthProvider();
        auth.signInWithPopup(provider)
            .then((result) => {
                console.log("Login exitoso:", result.user.email);
            })
            .catch(err => {
                console.error("Error completo:", err);
                alert("Error login: " + err.message + "\n\nCódigo: " + err.code);
            });
    }
};

auth.onAuthStateChanged(user => {
    console.log('Auth state changed:', user ? user.email : 'Sin usuario');
    state.user = user;
    
    // Clear local storage when logging in to prevent duplicate data
    if (user) {
        console.log('User logged in, localStorage will be synced or cleared in loadData()');
    }
    
    loadData();
});

// NAVIGATION
const navigate = (viewName) => {
    state.view = viewName;
    Object.values(views).forEach(el => el.classList.remove('active'));
    views[viewName].classList.add('active');

    // Update tabs
    document.querySelectorAll('.tab-btn').forEach(tab => tab.classList.remove('active'));
    const activeTab = document.querySelector(`.tab-btn[data-tab="${viewName}"]`);
    if (activeTab) activeTab.classList.add('active');

    if (viewName === 'list') {
        ui.pageTitle.textContent = 'Mis Recetas';
        ui.backBtn.classList.add('hidden');
        renderRecipeList();
    } else if (viewName === 'add') {
        ui.pageTitle.textContent = state.editingRecipeId ? 'Editar Receta' : 'Nueva Receta';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => {
            state.editingRecipeId = null;
            navigate('list');
        };
        if (!state.editingRecipeId) {
            resetForm();
        }
    } else if (viewName === 'shopping') {
        ui.pageTitle.textContent = 'Lista de Compra';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('list');
        renderShoppingList();
    } else if (viewName === 'pantry') {
        ui.pageTitle.textContent = 'Mi Despensa';
        ui.backBtn.classList.add('hidden');
        renderPantry();
    } else if (viewName === 'addPantry') {
        ui.pageTitle.textContent = 'Añadir a Despensa';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('pantry');
        resetPantryForm();
    } else if (viewName === 'history') {
        ui.pageTitle.textContent = 'Historial';
        ui.backBtn.classList.add('hidden');
        renderHistory();
    } else if (viewName === 'selectPurchase') {
        ui.pageTitle.textContent = 'Seleccionar Compra';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('pantry');
        renderPurchaseSelection();
    } else if (viewName === 'confirmPurchaseAdd') {
        ui.pageTitle.textContent = 'Confirmar Compra';
        ui.backBtn.textContent = '←';
        ui.backBtn.classList.remove('hidden');
        ui.backBtn.onclick = () => navigate('selectPurchase');
    }
};

// Initialize tabs
document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', () => {
        const targetView = tab.dataset.tab;
        navigate(targetView);
    });
});

// CORE DISPLAY LOGIC
const renderRecipeList = () => {
    containers.recipeList.innerHTML = '';

    if (state.recipes.length === 0) {
        const emptyMsg = state.user 
            ? '<p>No tienes recetas en la nube.</p><p>¡Crea una nueva o importa desde CSV!</p>' 
            : '<p>Inicia sesión con Google para gestionar tus recetas.</p>';
        
        const buttons = state.user 
            ? '<button onclick="navigate(\'add\')" class="btn">Crear nueva</button>' 
            : '<button onclick="document.getElementById(\'btn-login\').click()" class="btn">Iniciar Sesión</button>';
        
        containers.recipeList.innerHTML = `
            <div class="empty-state" style="text-align: center; padding: 40px; color: #888;">
                ${emptyMsg}
                <div style="display: flex; gap: 10px; justify-content: center; flex-direction: column; margin-top: 20px;">
                    ${buttons}
                </div>
            </div>`;
        ui.generateBtn.style.display = 'none';
        return;
    }

    state.recipes.forEach(recipe => {
        const div = document.createElement('div');
        div.className = `recipe-card ${state.selectedRecipeIds.has(recipe.id) ? 'selected' : ''}`;
        div.onclick = (e) => toggleSelection(recipe.id, div, e);

        // Nutrition info
        let nutritionHTML = '';
        if (recipe.nutrition && recipe.nutrition.calories) {
            nutritionHTML = `
                <div style="font-size: 0.85rem; color: #52796f; margin-top: 3px;">
                    🔥 ${recipe.nutrition.calories} kcal | 
                    P: ${recipe.nutrition.protein}g | 
                    C: ${recipe.nutrition.carbs}g | 
                    F: ${recipe.nutrition.fat}g
                </div>
            `;
        }

        div.innerHTML = `
            <div class="checkbox-wrapper">
                <input type="checkbox" ${state.selectedRecipeIds.has(recipe.id) ? 'checked' : ''} style="pointer-events: none;">
            </div>
            <div style="flex:1">
                <h3 style="margin:0; font-size: 1.1rem;">${recipe.name}</h3>
                <p class="text-muted" style="margin: 5px 0 0 0;">${recipe.ingredients.length} ingredientes</p>
                ${nutritionHTML}
            </div>
            <button class="btn btn-secondary btn-icon" onclick="editRecipe('${recipe.id}', event)" title="Editar" style="margin-right: 5px;">✏️</button>
            <button class="btn btn-danger btn-icon" onclick="deleteRecipe('${recipe.id}', event)" title="Eliminar">🗑️</button>
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
    state.editingRecipeId = null;
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

    // Calculate nutrition (async, show loading)
    const originalText = document.getElementById('btn-save-recipe').textContent;
    document.getElementById('btn-save-recipe').textContent = 'Calculando nutrición...';
    document.getElementById('btn-save-recipe').disabled = true;
    
    const nutrition = await calculateRecipeNutrition(ingredients);
    
    document.getElementById('btn-save-recipe').textContent = originalText;
    document.getElementById('btn-save-recipe').disabled = false;

    if (state.editingRecipeId) {
        // EDIT MODE: Update existing recipe
        const recipeIndex = state.recipes.findIndex(r => r.id === state.editingRecipeId);
        if (recipeIndex >= 0) {
            const updatedRecipe = {
                ...state.recipes[recipeIndex],
                name,
                ingredients,
                nutrition,
                updatedAt: Date.now()
            };
            
            state.recipes[recipeIndex] = updatedRecipe;
            
            if (state.user) {
                await db.collection('users').doc(state.user.uid).collection('recipes').doc(updatedRecipe.id).update({
                    name: updatedRecipe.name,
                    ingredients: updatedRecipe.ingredients,
                    nutrition: updatedRecipe.nutrition,
                    updatedAt: updatedRecipe.updatedAt
                });
            } else {
                saveData();
            }
        }
        state.editingRecipeId = null;
    } else {
        // CREATE MODE: New recipe
        const newRecipe = {
            id: uuid(),
            name,
            ingredients,
            nutrition,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        state.recipes.push(newRecipe);

        if (state.user) {
            await db.collection('users').doc(state.user.uid).collection('recipes').doc(newRecipe.id).set(newRecipe);
        } else {
            saveData();
        }
    }
    
    navigate('list');
};

const editRecipe = (id, event) => {
    event.stopPropagation();
    
    const recipe = state.recipes.find(r => r.id === id);
    if (!recipe) return;
    
    state.editingRecipeId = id;
    navigate('add');
    
    // Load recipe data into form
    document.getElementById('recipe-name').value = recipe.name;
    
    // Clear and populate ingredients
    containers.ingredientsList.innerHTML = '';
    recipe.ingredients.forEach(ing => {
        const div = document.createElement('div');
        div.className = 'ingredient-row';
        div.innerHTML = `
            <input type="text" placeholder="Ingrediente" class="ing-name" value="${ing.name}">
            <input type="number" placeholder="Cant." class="ing-qty" value="${ing.quantity}">
            <input type="text" placeholder="Unid." class="ing-unit" value="${ing.unit}">
            <button class="btn btn-danger btn-icon" onclick="this.parentElement.remove()">×</button>
        `;
        containers.ingredientsList.appendChild(div);
    });
};

// SHOPPING LIST
const renderShoppingList = () => {
    containers.shoppingListItems.innerHTML = '';
    ui.shopRecipeCount.textContent = state.selectedRecipeIds.size;

    // Calculate total nutrition from selected recipes
    let totalNutrition = { calories: 0, protein: 0, carbs: 0, fat: 0, count: 0 };
    state.selectedRecipeIds.forEach(id => {
        const recipe = state.recipes.find(r => r.id === id);
        if (recipe && recipe.nutrition && recipe.nutrition.calories) {
            totalNutrition.calories += recipe.nutrition.calories;
            totalNutrition.protein += parseFloat(recipe.nutrition.protein);
            totalNutrition.carbs += parseFloat(recipe.nutrition.carbs);
            totalNutrition.fat += parseFloat(recipe.nutrition.fat);
            totalNutrition.count++;
        }
    });

    // Show nutrition summary if available
    if (totalNutrition.count > 0) {
        const nutritionSummary = document.createElement('div');
        nutritionSummary.style.cssText = 'background: linear-gradient(135deg, #2d6a4f 0%, #52796f 100%); color: white; padding: 15px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);';
        nutritionSummary.innerHTML = `
            <div style="font-weight: 600; font-size: 1rem; margin-bottom: 8px;">📊 Resumen Nutricional Total</div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; font-size: 0.9rem;">
                <div><strong>Calorías:</strong> ${Math.round(totalNutrition.calories)} kcal</div>
                <div><strong>Proteínas:</strong> ${totalNutrition.protein.toFixed(1)}g</div>
                <div><strong>Carbohidratos:</strong> ${totalNutrition.carbs.toFixed(1)}g</div>
                <div><strong>Grasas:</strong> ${totalNutrition.fat.toFixed(1)}g</div>
            </div>
            <div style="font-size: 0.75rem; margin-top: 8px; opacity: 0.9;">
                ${totalNutrition.count} de ${state.selectedRecipeIds.size} recetas con datos nutricionales
            </div>
        `;
        containers.shoppingListItems.appendChild(nutritionSummary);
    }

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

    // Save to history when the list is generated
    saveShoppingListToHistory(aggregated).catch(err => {
        console.error('Error saving to history:', err);
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

// HISTORY
const saveShoppingListToHistory = async (aggregated) => {
    console.log('History: saveShoppingListToHistory called', {
        userLoggedIn: !!state.user,
        userId: state.user?.uid,
        email: state.user?.email
    });

    // Check if this exact list is already the most recent one
    if (state.history.length > 0) {
        const lastEntry = state.history[0];
        const recipeIds = Array.from(state.selectedRecipeIds).sort();
        const lastRecipeIds = lastEntry.recipeIds.sort();
        
        // If same recipes, don't save duplicate
        if (JSON.stringify(recipeIds) === JSON.stringify(lastRecipeIds)) {
            console.log('History: Skipping duplicate entry');
            return;
        }
    }

    const recipeIds = Array.from(state.selectedRecipeIds);
    const recipeNames = recipeIds.map(id => {
        const recipe = state.recipes.find(r => r.id === id);
        return recipe ? recipe.name : 'Desconocida';
    });

    const items = Object.keys(aggregated).sort().map(key => ({
        name: aggregated[key].name,
        quantity: aggregated[key].quantity,
        unit: aggregated[key].unit
    }));

    const historyEntry = {
        id: uuid(),
        date: Date.now(),
        recipeIds,
        recipeNames,
        items
    };

    state.history.unshift(historyEntry);
    console.log('History: New entry created', historyEntry);

    if (state.user) {
        try {
            console.log('History: Attempting to save to Firebase...');
            const docRef = db.collection('users').doc(state.user.uid).collection('history').doc(historyEntry.id);
            await docRef.set(historyEntry);
            console.log('History: ✅ Saved to Firebase successfully', docRef.path);
        } catch (error) {
            console.error('History: ❌ Error saving to Firebase', error);
            alert('Error al guardar en la nube: ' + error.message);
        }
    } else {
        console.log('History: No user logged in, saving to localStorage');
        saveData();
        console.log('History: Saved to localStorage', state.history.length, 'entries');
    }
};

const renderHistory = () => {
    containers.historyList.innerHTML = '';
    
    if (state.history.length === 0) {
        containers.historyList.innerHTML = '<p class="text-center text-muted" style="padding: 40px;">No hay historial aún.</p>';
        return;
    }

    state.history.forEach((entry, index) => {
        const div = document.createElement('div');
        div.className = 'history-card';
        div.dataset.historyId = entry.id;
        div.dataset.expanded = 'false';
        
        const date = new Date(entry.date);
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        
        const showExpandBtn = entry.items.length > 5;
        const itemsToShow = entry.items.slice(0, 5);
        
        const itemsHTML = itemsToShow.map(item => 
            `<div>• ${item.name} (${item.quantity} ${item.unit})</div>`
        ).join('');
        
        const hiddenItemsHTML = entry.items.slice(5).map(item => 
            `<div class="history-hidden-items" style="display: none;">• ${item.name} (${item.quantity} ${item.unit})</div>`
        ).join('');
        
        const expandBtn = showExpandBtn ? `
            <div class="history-expand-btn" style="color: var(--color-primary); font-size: 0.85rem; cursor: pointer; margin-top: 8px; font-weight: 500;">
                ▼ Ver ${entry.items.length - 5} ingredientes más
            </div>
        ` : '';
        
        div.innerHTML = `
            <div class="history-card-header">
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">${entry.recipeNames.join(' + ')}</div>
                    <div class="history-card-date">${dateStr} a las ${timeStr}</div>
                </div>
                <button class="btn btn-danger btn-icon" style="width: 32px; height: 32px; font-size: 0.9rem;" onclick="deleteHistory('${entry.id}', event)">🗑️</button>
            </div>
            <div class="history-card-items">
                ${itemsHTML}
                ${hiddenItemsHTML}
                ${expandBtn}
            </div>
        `;
        
        // Add click handler to expand button
        if (showExpandBtn) {
            const itemsContainer = div.querySelector('.history-card-items');
            const expandButton = div.querySelector('.history-expand-btn');
            
            expandButton.onclick = (e) => {
                e.stopPropagation();
                const isExpanded = div.dataset.expanded === 'true';
                const hiddenItems = div.querySelectorAll('.history-hidden-items');
                
                if (isExpanded) {
                    // Collapse
                    hiddenItems.forEach(item => item.style.display = 'none');
                    expandButton.innerHTML = `▼ Ver ${entry.items.length - 5} ingredientes más`;
                    div.dataset.expanded = 'false';
                } else {
                    // Expand
                    hiddenItems.forEach(item => item.style.display = 'block');
                    expandButton.innerHTML = `▲ Ver menos`;
                    div.dataset.expanded = 'true';
                }
            };
        }
        
        containers.historyList.appendChild(div);
    });
};

const deleteHistory = async (id, event) => {
    if (event) event.stopPropagation();
    if (!confirm('¿Eliminar este historial?')) return;
    
    console.log('History: Deleting entry', { id, userLoggedIn: !!state.user });
    
    state.history = state.history.filter(h => h.id !== id);
    renderHistory();
    
    if (state.user) {
        try {
            await db.collection('users').doc(state.user.uid).collection('history').doc(id).delete();
            console.log('History: ✅ Deleted from Firebase');
        } catch (error) {
            console.error('History: ❌ Error deleting from Firebase', error);
        }
    } else {
        saveData();
        console.log('History: Deleted from localStorage');
    }
};

const clearHistory = async () => {
    if (state.history.length === 0) {
        alert('El historial ya está vacío.');
        return;
    }

    const count = state.history.length;
    if (!confirm(`¿Estás seguro de que quieres vaciar todo el historial?\n\nSe eliminarán ${count} entrada(s).`)) return;

    const historyToDelete = [...state.history];
    state.history = [];
    renderHistory();

    if (state.user) {
        try {
            const batch = db.batch();
            historyToDelete.forEach(entry => {
                const docRef = db.collection('users').doc(state.user.uid).collection('history').doc(entry.id);
                batch.delete(docRef);
            });
            await batch.commit();
            console.log('History: ✅ Cleared from Firebase');
        } catch (error) {
            console.error('History: ❌ Error clearing Firebase', error);
            // Restore on error
            state.history = historyToDelete;
            renderHistory();
            alert('Error al vaciar el historial: ' + error.message);
        }
    } else {
        saveData();
        console.log('History: Cleared from localStorage');
    }

    alert('¡Historial vaciado correctamente!');
};

// PANTRY - ADD MANUALLY
const resetPantryForm = () => {
    document.getElementById('pantry-item-name').value = '';
    document.getElementById('pantry-item-qty').value = '';
    document.getElementById('pantry-item-unit').value = '';
};

const savePantryItem = async () => {
    const name = document.getElementById('pantry-item-name').value.trim();
    const quantity = parseFloat(document.getElementById('pantry-item-qty').value) || 0;
    const unit = document.getElementById('pantry-item-unit').value.trim();

    if (!name) return alert('Introduce el nombre del ingrediente.');
    if (quantity <= 0) return alert('La cantidad debe ser mayor que 0.');
    if (!unit) return alert('Introduce la unidad (kg, unidades, etc.).');

    const newItem = {
        id: uuid(),
        name,
        quantity,
        unit,
        updatedAt: Date.now()
    };

    // Check if exists (same name + unit)
    const existingIdx = state.pantry.findIndex(p => 
        p.name.toLowerCase() === name.toLowerCase() && 
        p.unit.toLowerCase() === unit.toLowerCase()
    );

    if (existingIdx >= 0) {
        // Update existing
        state.pantry[existingIdx].quantity += quantity;
        state.pantry[existingIdx].updatedAt = Date.now();
        
        if (state.user) {
            await db.collection('users').doc(state.user.uid).collection('pantry').doc(state.pantry[existingIdx].id).update({
                quantity: state.pantry[existingIdx].quantity,
                updatedAt: state.pantry[existingIdx].updatedAt
            });
        }
    } else {
        // Add new
        state.pantry.push(newItem);
        
        if (state.user) {
            await db.collection('users').doc(state.user.uid).collection('pantry').doc(newItem.id).set(newItem);
        }
    }

    if (!state.user) {
        saveData();
    }

    navigate('pantry');
};

// ADD PURCHASE FROM HISTORY
const renderPurchaseSelection = () => {
    containers.purchaseSelectionList.innerHTML = '';
    
    if (state.history.length === 0) {
        containers.purchaseSelectionList.innerHTML = '<p class="text-center text-muted" style="padding: 40px;">No hay compras en el historial.</p>';
        return;
    }

    state.history.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'history-card';
        div.style.cssText = 'cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;';
        div.onclick = () => selectPurchaseFromHistory(entry);
        
        // Hover effect
        div.onmouseenter = () => {
            div.style.transform = 'scale(1.02)';
            div.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
        };
        div.onmouseleave = () => {
            div.style.transform = 'scale(1)';
            div.style.boxShadow = '';
        };
        
        const date = new Date(entry.date);
        const dateStr = date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
        const timeStr = date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        
        const itemsHTML = entry.items.slice(0, 3).map(item => 
            `<div>• ${item.name} (${item.quantity} ${item.unit})</div>`
        ).join('');
        
        const moreItems = entry.items.length > 3 ? `<div class="text-muted">... y ${entry.items.length - 3} más</div>` : '';
        
        div.innerHTML = `
            <div class="history-card-header">
                <div>
                    <div style="font-weight: 600; margin-bottom: 4px;">${entry.recipeNames.join(' + ')}</div>
                    <div class="history-card-date">${dateStr} a las ${timeStr}</div>
                </div>
                <div style="color: var(--color-primary); font-size: 1.5rem;">→</div>
            </div>
            <div class="history-card-items">
                ${itemsHTML}
                ${moreItems}
            </div>
        `;
        
        containers.purchaseSelectionList.appendChild(div);
    });
};

const selectPurchaseFromHistory = (purchase) => {
    state.selectedPurchase = purchase;
    navigate('confirmPurchaseAdd');
    renderPurchaseAdjust();
};

const renderPurchaseAdjust = () => {
    if (!state.selectedPurchase) return;
    
    containers.purchaseItemsAdjust.innerHTML = '';
    
    state.selectedPurchase.items.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'confirm-row';
        div.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; padding-bottom:15px; border-bottom:1px solid #eee;';
        div.innerHTML = `
            <div style="flex:1">
                <div style="font-weight:500; font-size: 1rem;">${item.name}</div>
                <div class="text-muted" style="font-size:0.85rem">Original: ${item.quantity} ${item.unit}</div>
            </div>
            <div style="flex:0 0 120px; text-align:right;">
                <input type="number" 
                    class="purchase-adjust-qty" 
                    data-index="${index}" 
                    value="${item.quantity}" 
                    step="0.1"
                    style="width:100%; padding:8px; border:1px solid var(--color-border); border-radius:6px; font-size:1rem; text-align: center;">
                <div style="font-size:0.8rem; color:#888; text-align:center; margin-top: 4px;">${item.unit}</div>
            </div>
        `;
        containers.purchaseItemsAdjust.appendChild(div);
    });
};

const confirmAddPurchase = async () => {
    if (!state.selectedPurchase) return;
    
    const inputs = document.querySelectorAll('.purchase-adjust-qty');
    const today = Date.now();
    
    const itemsToAdd = [];
    inputs.forEach(input => {
        const index = parseInt(input.dataset.index);
        const quantity = parseFloat(input.value) || 0;
        const originalItem = state.selectedPurchase.items[index];
        
        if (quantity > 0) {
            itemsToAdd.push({
                name: originalItem.name,
                quantity: quantity,
                unit: originalItem.unit
            });
        }
    });
    
    if (itemsToAdd.length === 0) {
        return alert('Añade al menos un ingrediente con cantidad mayor a 0.');
    }
    
    // Add or update pantry items
    const batch = state.user ? db.batch() : null;
    
    for (const item of itemsToAdd) {
        const existingIdx = state.pantry.findIndex(p => 
            p.name.toLowerCase() === item.name.toLowerCase() && 
            p.unit.toLowerCase() === item.unit.toLowerCase()
        );
        
        if (existingIdx >= 0) {
            // Update existing
            state.pantry[existingIdx].quantity += item.quantity;
            state.pantry[existingIdx].updatedAt = today;
            
            if (state.user) {
                const ref = db.collection('users').doc(state.user.uid).collection('pantry').doc(state.pantry[existingIdx].id);
                batch.update(ref, {
                    quantity: state.pantry[existingIdx].quantity,
                    updatedAt: state.pantry[existingIdx].updatedAt
                });
            }
        } else {
            // Add new
            const newItem = {
                id: uuid(),
                name: item.name,
                quantity: item.quantity,
                unit: item.unit,
                updatedAt: today
            };
            state.pantry.push(newItem);
            
            if (state.user) {
                const ref = db.collection('users').doc(state.user.uid).collection('pantry').doc(newItem.id);
                batch.set(ref, newItem);
            }
        }
    }
    
    if (state.user) {
        await batch.commit();
    } else {
        saveData();
    }
    
    state.selectedPurchase = null;
    alert(`¡${itemsToAdd.length} ingrediente(s) añadido(s) a tu despensa!`);
    navigate('pantry');
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
        div.style.cssText = 'display: flex; align-items: center; gap: 10px;';
        div.innerHTML = `
            <span style="font-weight:500; flex: 1;">${item.name}</span>
            <span class="text-muted">${item.quantity} ${item.unit}</span>
            <button class="btn btn-danger btn-icon" style="width: 32px; height: 32px; font-size: 0.9rem;" onclick="deletePantryItem('${item.id}')">×</button>
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

const clearPantry = async () => {
    if (state.pantry.length === 0) {
        alert('La despensa ya está vacía.');
        return;
    }

    const count = state.pantry.length;
    if (!confirm(`¿Estás seguro de que quieres vaciar toda la despensa?\n\nSe eliminarán ${count} ingrediente(s).`)) return;

    const pantryToDelete = [...state.pantry];
    state.pantry = [];
    renderPantry();

    if (state.user) {
        try {
            const batch = db.batch();
            pantryToDelete.forEach(item => {
                const docRef = db.collection('users').doc(state.user.uid).collection('pantry').doc(item.id);
                batch.delete(docRef);
            });
            await batch.commit();
            console.log('Pantry: ✅ Cleared from Firebase');
        } catch (error) {
            console.error('Pantry: ❌ Error clearing Firebase', error);
            // Restore on error
            state.pantry = pantryToDelete;
            renderPantry();
            alert('Error al vaciar la despensa: ' + error.message);
        }
    } else {
        saveData();
        console.log('Pantry: Cleared from localStorage');
    }

    alert('¡Despensa vaciada correctamente!');
};

// EVENT LISTENERS
document.getElementById('btn-add-recipe').onclick = () => {
    state.editingRecipeId = null;
    navigate('add');
};
document.getElementById('btn-cancel-add').onclick = () => {
    state.editingRecipeId = null;
    navigate('list');
};
document.getElementById('btn-add-ingredient').onclick = addIngredientRow;
document.getElementById('btn-save-recipe').onclick = saveRecipe;
document.getElementById('btn-generate-shop').onclick = () => navigate('shopping');
document.getElementById('btn-back-list').onclick = () => navigate('list');
document.getElementById('btn-start-purchase').onclick = startPurchase;
document.getElementById('btn-cancel-purchase').onclick = cancelPurchase;
document.getElementById('btn-confirm-purchase').onclick = confirmPurchase;

// Pantry buttons
document.getElementById('btn-add-pantry-item').onclick = () => navigate('addPantry');
document.getElementById('btn-cancel-add-pantry').onclick = () => navigate('pantry');
document.getElementById('btn-save-pantry-item').onclick = savePantryItem;
document.getElementById('btn-add-purchase').onclick = () => navigate('selectPurchase');
document.getElementById('btn-cancel-purchase-add').onclick = () => navigate('pantry');
document.getElementById('btn-confirm-purchase-add').onclick = confirmAddPurchase;
document.getElementById('btn-clear-pantry').onclick = clearPantry;

// History buttons
document.getElementById('btn-clear-history').onclick = clearHistory;

// Debug button
document.getElementById('btn-debug').onclick = async () => {
    const swRegistration = await navigator.serviceWorker.getRegistration();
    const cacheNames = await caches.keys();
    
    // Check for duplicates
    const recipeNames = state.recipes.map(r => r.name.toLowerCase().trim());
    const duplicates = recipeNames.filter((name, index) => recipeNames.indexOf(name) !== index);
    const uniqueDuplicates = [...new Set(duplicates)];
    
    const info = {
        'Usuario logueado': !!state.user,
        'Email': state.user?.email || 'N/A',
        'UID': state.user?.uid || 'N/A',
        'Recetas': state.recipes.length,
        'Recetas duplicadas': uniqueDuplicates.length > 0 ? uniqueDuplicates.join(', ') : 'Ninguna',
        'Despensa items': state.pantry.length,
        'Historial items': state.history.length,
        'Firebase conectado': !!db,
        'localStorage recipes': JSON.parse(localStorage.getItem('recipes') || '[]').length,
        'localStorage pantry': JSON.parse(localStorage.getItem('pantry') || '[]').length,
        'localStorage history': JSON.parse(localStorage.getItem('history') || '[]').length,
        'Service Worker': swRegistration ? 'Registrado' : 'No registrado',
        'Cachés activos': cacheNames.join(', ') || 'Ninguno'
    };
    
    console.log('🐛 DEBUG INFO:', info);
    
    const message = Object.entries(info)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n');
    
    let action;
    if (uniqueDuplicates.length > 0) {
        action = confirm('🐛 Debug Info:\n\n' + message + '\n\n⚠️ Se detectaron recetas duplicadas.\n¿Quieres eliminar los duplicados automáticamente?\n(Se mantendrá la versión más reciente de cada receta)');
        
        if (action) {
            await removeDuplicateRecipes();
            alert('Duplicados eliminados. Recargando...');
            window.location.reload();
            return;
        }
    }
    
    action = confirm('🐛 Debug Info:\n\n' + message + '\n\n¿Quieres forzar una actualización de la app?\n(Esto limpiará la caché y recargará)');
    
    if (action) {
        console.log('Forzando actualización...');
        
        // Clear all caches
        const allCaches = await caches.keys();
        await Promise.all(allCaches.map(cache => caches.delete(cache)));
        console.log('Cachés eliminadas:', allCaches);
        
        // Unregister service worker
        if (swRegistration) {
            await swRegistration.unregister();
            console.log('Service Worker desregistrado');
        }
        
        // Force reload
        alert('App limpiada. Se recargará ahora.');
        window.location.reload(true);
    }
};

// Remove duplicate recipes (keeps most recent)
const removeDuplicateRecipes = async () => {
    const seen = new Map(); // name -> recipe
    const toDelete = [];
    
    // Sort by updatedAt descending (most recent first)
    const sorted = [...state.recipes].sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    
    sorted.forEach(recipe => {
        const key = recipe.name.toLowerCase().trim();
        if (seen.has(key)) {
            // Duplicate found, mark for deletion
            toDelete.push(recipe.id);
        } else {
            // First occurrence, keep it
            seen.set(key, recipe);
        }
    });
    
    console.log('Removing duplicates:', toDelete);
    
    if (toDelete.length === 0) {
        alert('No se encontraron duplicados.');
        return;
    }
    
    // Remove from state
    state.recipes = state.recipes.filter(r => !toDelete.includes(r.id));
    
    // Remove from database
    if (state.user) {
        const batch = db.batch();
        toDelete.forEach(id => {
            const ref = db.collection('users').doc(state.user.uid).collection('recipes').doc(id);
            batch.delete(ref);
        });
        await batch.commit();
    } else {
        saveData();
    }
    
    console.log(`Removed ${toDelete.length} duplicate(s)`);
};

// REGISTER SERVICE WORKER
if ('serviceWorker' in navigator) {
    let refreshing = false;
    
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => {
                console.log('SW registered:', reg);
                
                // Check for updates every 5 seconds (aggressively)
                setInterval(() => {
                    console.log('SW: Checking for updates...');
                    reg.update();
                }, 5000);
                
                // Listen for updates
                reg.addEventListener('updatefound', () => {
                    const newWorker = reg.installing;
                    console.log('SW: Update found! Installing...');
                    
                    newWorker.addEventListener('statechange', () => {
                        console.log('SW: State changed to', newWorker.state);
                        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                            // New service worker is ready to take over
                            console.log('SW: New version ready!');
                            
                            // Show a more visible notification
                            const updateBanner = document.createElement('div');
                            updateBanner.style.cssText = `
                                position: fixed;
                                top: 0;
                                left: 0;
                                right: 0;
                                background: #2d6a4f;
                                color: white;
                                padding: 15px;
                                text-align: center;
                                z-index: 9999;
                                font-weight: bold;
                                box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                            `;
                            updateBanner.innerHTML = `
                                ¡Nueva versión disponible! 
                                <button onclick="window.location.reload()" style="margin-left: 10px; padding: 8px 15px; background: white; color: #2d6a4f; border: none; border-radius: 5px; cursor: pointer; font-weight: bold;">
                                    Actualizar ahora
                                </button>
                            `;
                            document.body.appendChild(updateBanner);
                        }
                    });
                });
            })
            .catch(err => console.log('SW failed', err));
    });
    
    // Handle controller change (new SW took over)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            console.log('SW: Controller changed, reloading...');
            refreshing = true;
            window.location.reload();
        }
    });
}
