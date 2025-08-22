require('dotenv').config();
const express = require("express");
const app = express();
app.use(express.json());

// Middleware de log
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

const cors = require('cors'); // Ajoute cette ligne

// Active CORS pour toutes les origines (ou spécifie des origines spécifiques si nécessaire)
app.use(cors({
    origin: 'http://localhost:3001', // Autoriser uniquement localhost:3001
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Autoriser certains types de requêtes
    allowedHeaders: ['Content-Type', 'Authorization'] // Autoriser certains headers
}));

// Route de test
app.get("/", (req, res) => {
    res.send("Bienvenue sur le serveur Express de réservation de terrains !");
});


// Importation des routes complémentaires
const authRoutes = require("./routes/auth");
const utilisateursRoutes = require("./routes/utilisateurs");
const terrainsRoutes = require("./routes/terrains");
const reservationsRoutes = require("./routes/reservations");
const recommandationsRoutes = require('./routes/recommandations');
const chatbotV2Routes = require('./routes/chatbot');
const webhook = require('./routes/webhook');

app.use("/api/auth", authRoutes);
app.use("/api/users", utilisateursRoutes);
app.use("/api/terrains", terrainsRoutes);
app.use("/api/reservations", reservationsRoutes);
app.use('/api/recommandations', recommandationsRoutes);
app.use('/api/chatbot', chatbotV2Routes);
app.use('/api/webhook', webhook);

// Middleware de gestion des erreurs
const errorHandler = require('./middlewares/errorHandler');
const { func } = require('joi');
app.use(errorHandler);

app.listen(3000, () => {
    console.log("🚀 Serveur en écoute sur http://localhost:3000");
});