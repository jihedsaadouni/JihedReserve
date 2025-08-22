// routes/auth.js

// Importation d'Express pour créer un routeur dédié aux routes d'authentification
const express = require('express');
// Création d'un routeur pour gérer les endpoints d'authentification
const app = express.Router();

// Importation de bcrypt pour hacher et comparer les mots de passe
const bcrypt = require('bcrypt');
// Importation de jsonwebtoken pour générer et vérifier les tokens JWT
const jwt = require('jsonwebtoken');

// Importation de la connexion à la base de données (config/db.js)
const db = require('../config/db');

// Charger les variables d'environnement (cela charge le contenu du fichier .env)
// Assure-toi d'avoir déjà installé et configuré le module dotenv dans ton projet.
require('dotenv').config();

const verifierToken = require("../middlewares/verifierToken"); // Importer le middleware
const verifierRole = require("../middlewares/verifierRole");
const { schemaCreationUtilisateur } = require('../validations/utilisateurValidation');





// 📌 Route d'inscription publique (accessible à tous)
app.post("/register", async (req, res) => {
    // Validation des données avec Joi
    const { error } = schemaCreationUtilisateur.validate(req.body);
    if (error) {
        const field = error.details[0].context?.key;

        // Messages personnalisés pour chaque champ
        const messages = {
            nom: "Le nom est obligatoire et doit contenir entre 3 et 50 caractères.",
            email: "L'email est invalide. Veuillez entrer une adresse email valide.",
            telephone: "Le numéro de téléphone doit contenir exactement 8 chiffres.",
            mot_de_passe: "Le mot de passe doit contenir au moins 6 caractères.",
        };

        return res.status(400).json({ error: messages[field] || "Données invalides." });
    }

    const { nom, telephone, email, mot_de_passe } = req.body;

    try {
        // Vérifier si l'utilisateur existe déjà avec cet email
        const [rows] = await db.promise().query("SELECT * FROM utilisateurs WHERE email = ?", [email]);
        if (rows.length > 0) {
            return res.status(400).json({ error: "Cet email est déjà utilisé. Veuillez en choisir un autre." });
        }

        // Hachage du mot de passe
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

        // Insérer l'utilisateur en base de données
        await db.promise().query(
            "INSERT INTO utilisateurs (nom, email, mot_de_passe, telephone) VALUES (?, ?, ?, ?)",
            [nom, email, hashedPassword, telephone]
        );

        res.status(201).json({ message: "Compte créé avec succès !" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Erreur serveur. Veuillez réessayer plus tard." });
    }
});

// 📌 Seul un admin peut créer un nouvel utilisateur avec un rôle spécifique
app.post("/admin/register", verifierToken, verifierRole("admin"), async (req, res) => {
    // Validation des données avec Joi
    const { error } = schemaCreationUtilisateur.validate(req.body);
    if (error) {
        console.log(error.details[0].message);
        return res.status(400).json({ error: error.details[0].message });
    }
    const { nom, telephone, email, mot_de_passe, role } = req.body;

    if (!nom || !telephone || !email || !mot_de_passe || !role) {
        return res.status(400).json({ error: "Tous les champs sont requis" });
    }

    try {
        // Vérifier si l'utilisateur existe déjà
        const [rows] = await db.promise().query("SELECT * FROM utilisateurs WHERE email = ?", [email]);
        if (rows.length > 0) {
            return res.status(400).json({ error: "Cet email est déjà utilisé" });
        }

        // Hachage du mot de passe
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

        // Insérer l'utilisateur avec le rôle défini par l'admin
        await db.promise().query(
            "INSERT INTO utilisateurs (nom, email, mot_de_passe, telephone, role) VALUES (?, ?, ?, ?, ?)",
            [nom, email, hashedPassword, telephone, role]
        );

        res.status(201).json({ message: "Utilisateur créé avec succès !" });
    } catch (err) {
        res.status(500).json({ error: "Erreur serveur" });
    }
});


app.post("/login", (req, res) => {
    const { email, mot_de_passe } = req.body;

    // Vérifier que l'email et le mot de passe sont fournis
    if (!email && !mot_de_passe) {
        return res.status(400).json({ error: "L'email et le mot de passe sont requis." });
    }
    if (!email) {
        return res.status(400).json({ error: "L'email est requis." });
    }
    if (!mot_de_passe) {
        return res.status(400).json({ error: "Le mot de passe est requis." });
    }

    // Vérifier si l'utilisateur existe
    db.query("SELECT * FROM utilisateurs WHERE email = ?", [email], async (err, results) => {
        if (err) {
            return res.status(500).json({ error: "Erreur serveur, veuillez réessayer plus tard." });
        }
        if (results.length === 0) {
            return res.status(401).json({ error: "Cet email n'existe pas." });
        }

        const utilisateur = results[0];

        // Vérifier si le mot de passe est correct
        bcrypt.compare(mot_de_passe, utilisateur.mot_de_passe, (err, isMatch) => {
            if (err) {
                return res.status(500).json({ error: "Erreur serveur, veuillez réessayer plus tard." });
            }
            if (!isMatch) {
                return res.status(401).json({ error: "Mot de passe incorrect." });
            }

            // ✅ Générer le token avec l'ID utilisateur
            const accessToken = jwt.sign(
                {
                    id_utilisateur: utilisateur.id_utilisateur, // ⚠️ Assure-toi d'inclure l'ID utilisateur ici
                    role: utilisateur.role,
                    email: utilisateur.email
                },
                process.env.JWT_SECRET,
                { expiresIn: "10h" }
            );

            // ✅ Générer le refresh token
            const refreshToken = jwt.sign(
                { id_utilisateur: utilisateur.id_utilisateur },
                process.env.JWT_REFRESH_SECRET,
                { expiresIn: "7d" }
            );

            // Sauvegarder le refresh token en base de données
            db.query("UPDATE utilisateurs SET refresh_token = ? WHERE id_utilisateur = ?", [refreshToken, utilisateur.id_utilisateur]);

            res.json({ accessToken, refreshToken, user: { id_utilisateur: utilisateur.id_utilisateur, email: utilisateur.email, role: utilisateur.role } });
        });
    });
});

// 🔄 1️⃣ Route pour rafraîchir un token expiré
app.post("/refresh", (req, res) => {
    // 📌 Récupérer le refreshToken depuis le corps de la requête
    const { refreshToken } = req.body;

    // 🔍 2️⃣ Vérifier si un refreshToken a bien été envoyé
    if (!refreshToken) {
        return res.status(401).json({ error: "Aucun refresh token fourni" });
    }

    // 🔐 3️⃣ Vérifier la validité du refreshToken
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, (err, decoded) => {
        if (err) {
            // 🔸 Séparer les erreurs entre un token expiré et un token invalide
            if (err.name === "TokenExpiredError") {
                return res.status(403).json({ error: "Refresh token expiré, veuillez vous reconnecter" });
            }
            console.log(err);
            return res.status(403).json({ error: "Refresh token invalide" });
        }

        // 🆕 4️⃣ Générer un nouveau accessToken valide
        const newAccessToken = jwt.sign(
            { id_utilisateur: decoded.id_utilisateur, email: decoded.email, role: decoded.role }, // Payload
            process.env.JWT_SECRET, // Clé secrète principale
            { expiresIn: "1h" } // Expiration du token (1 heure)
        );

        // 🎯 5️⃣ Retourner le nouveau accessToken au client
        res.json({ newAccessToken });
    });
});

// 📌 Route de déconnexion (supprime le refresh token)
app.post("/logout", (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) return res.status(400).json({ error: "Aucun refresh token fourni" });

    // Supprimer le refresh token de la base
    db.query("UPDATE utilisateurs SET refresh_token = NULL WHERE refresh_token = ?", [refreshToken], (err) => {
        if (err) return res.status(500).json({ error: "Erreur serveur" });

        res.json({ message: "Déconnexion réussie" });
    });
});
// Route pour vérifier la validité du token
app.get("/verify-token", verifierToken, (req, res) => {
    res.json({ valid: true, user: req.user });
});

// Exporter le router pour qu'il soit accessible dans d'autres fichiers
module.exports = app;


