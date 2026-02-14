# 🍳 Recetas PWA

Progressive Web App para gestionar recetas, generar listas de compra y administrar tu despensa.

## ✨ Características

- 📱 **PWA**: Funciona offline y se puede instalar como app
- 🔐 **Autenticación con Google**: Sincroniza tus recetas en la nube
- 📋 **Gestión de recetas**: Crea, edita y elimina recetas
- 🛒 **Lista de compra**: Genera listas automáticas desde tus recetas
- 📦 **Despensa**: Gestiona ingredientes sobrantes
- 📁 **Importar CSV**: Importa recetas masivamente desde archivo CSV

## 🚀 Demo

[Ver demo en Netlify](https://your-app.netlify.app)

## 🛠️ Tecnologías

- HTML5, CSS3, JavaScript (Vanilla)
- Firebase Authentication
- Cloud Firestore
- Service Worker (PWA)
- Netlify (Hosting)

## 📦 Instalación Local

1. Clona el repositorio:
```bash
git clone https://github.com/tu-usuario/recipe_pwa.git
cd recipe_pwa
```

2. Configura Firebase:
   - Crea un proyecto en [Firebase Console](https://console.firebase.google.com/)
   - Activa Authentication (Google Sign-In)
   - Activa Firestore Database
   - Copia tu configuración de Firebase en `app.js`

3. Abre `index.html` en un servidor local:
```bash
# Con Python 3
python -m http.server 8000

# Con Node.js (npx)
npx serve
```

4. Visita `http://localhost:8000`

## 📝 Formato CSV para Importar

### Opción 1: Formato simple (name,ingredients)
```csv
name,ingredients
"Lentejas","lentejas:250:g|agua:500:ml|cebolla:1:unit"
"Tortilla","huevos:3:unit|patata:200:g|sal:1:pinch"
```

### Opción 2: Formato con columnas por ingrediente
```csv
Number,Name,Time,Brown onion,Tomatoes (g),Garlic gloves,...
9089,Spiced Tofu Sofritas,20',,4,,20,...
```

## 🔒 Reglas de Firestore

Copia estas reglas en Firebase Console → Firestore → Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/recipes/{recipeId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    match /users/{userId}/pantry/{pantryId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 📂 Estructura del Proyecto

```
recipe_pwa/
├── index.html          # Página principal
├── app.js              # Lógica principal y Firebase
├── importer.js         # Importador CSV
├── style.css           # Estilos
├── sw.js               # Service Worker (PWA)
├── manifest.json       # Manifest PWA
├── icon-192.png        # Icono de la app
├── netlify.toml        # Configuración de Netlify
└── README.md           # Este archivo
```

## 🤝 Contribuir

Las contribuciones son bienvenidas. Por favor:

1. Haz fork del proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📄 Licencia

Este proyecto es de código abierto y está disponible bajo la [MIT License](LICENSE).

## 👤 Autor

Tu nombre - [@tu-usuario](https://github.com/tu-usuario)

---

⭐️ Si te gusta este proyecto, dale una estrella en GitHub!
