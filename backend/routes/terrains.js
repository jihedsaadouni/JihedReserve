//Les terrains

// Importation d'Express pour créer un routeur dédié aux routes d'authentification
const express = require('express');
// Création d'un routeur pour gérer les endpoints d'authentification
const app = express.Router();

// Importation de la connexion à la base de données (config/db.js)
const db = require('../config/db');
// Importation de bcrypt pour hacher et comparer les mots de passe
const bcrypt = require('bcrypt');
// Importation de jsonwebtoken pour générer et vérifier les tokens JWT
const jwt = require('jsonwebtoken');
// Charger les variables d'environnement (cela charge le contenu du fichier .env)
// Assure-toi d'avoir déjà installé et configuré le module dotenv dans ton projet.
require('dotenv').config();
const verifierToken = require("../middlewares/verifierToken"); // Importation du middleware
const verifierRole = require("../middlewares/verifierRole");
const { schemaCreationTerrain, schemaValidationId } = require('../validations/reservationValidation');
// Récupérer la liste de tous les terrains
app.get("/", (req, res) => {
    const sql = "SELECT * FROM terrains";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Erreur", err);
            res.status(500).json({ error: "Erreur lors de la récupération des terrains" });
        } else {
            res.json(results);
        }
    });
});
// 📌 Route pour récupérer les créneaux disponibles d’un terrain spécifique
app.get("/terrain-disponible/:id", async (req, res) => {
    try {
        const { id } = req.params; // Récupérer l'ID du terrain depuis l'URL
        const { date } = req.query; // Récupérer la date depuis les paramètres de requête

        if (!date) {
            return res.status(400).json({ error: "La date est requise." });
        }

        // ✅ Vérifier si le terrain existe
        const terrainQuery = `
            SELECT id_terrain, nom, localisation, prix_par_science, description, image, listImages
            FROM terrains
            WHERE id_terrain = ?
        `;
        const [terrain] = await db.promise().query(terrainQuery, [id]);

        if (terrain.length === 0) {
            return res.status(404).json({ error: "Terrain non trouvé." });
        }

        // ✅ Récupérer toutes les réservations pour ce terrain et la date donnée
        const reservationsQuery = `
            SELECT heure_debut, heure_fin 
            FROM reservations 
            WHERE id_terrain = ? 
            AND date_reservation = ? 
            AND statut IN ('Confirmée', 'En attente') 
        `;
        const [reservations] = await db.promise().query(reservationsQuery, [id, date]);

        // ✅ Générer les créneaux horaires de 1h30 entre 08h00 et 00h00, formatés en "HH:mm"
        const horaires = [];
        let heure = 8;

        while (heure < 24) {
            const heureDebutHeure = Math.floor(heure);
            const heureDebutMinutes = (heure % 1 === 0.5) ? "30" : "00";

            const heureFin = heure + 1.5;
            const heureFinHeure = Math.floor(heureFin);
            const heureFinMinutes = (heureFin % 1 === 0.5) ? "30" : "00";

            const heureDebutStr = `${heureDebutHeure.toString().padStart(2, "0")}:${heureDebutMinutes}`;
            const heureFinStr = `${heureFinHeure.toString().padStart(2, "0")}:${heureFinMinutes}`;

            horaires.push({ heureDebut: heureDebutStr, heureFin: heureFinStr });

            heure += 1.5;
        }

        // ✅ Filtrer les créneaux déjà réservés
        const horairesLibres = horaires.filter(horaire =>
            !reservations.some(r =>
                r.heure_debut.startsWith(horaire.heureDebut) || r.heure_fin.startsWith(horaire.heureFin)
            )
        );

        // ✅ Réponse finale
        res.json({
            ...terrain[0],
            disponibilites: horairesLibres,
        });
    } catch (error) {
        console.error("Erreur lors de la récupération des créneaux :", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});


// Récupérer un terrain par son id
app.get("/:id", (req, res) => {
    const terrainId = req.params.id; // Récupération de l'ID du terrain depuis l'URL
    // 🔍 Validation de l'ID
    const { error } = schemaValidationId.validate({ id: terrainId });
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }

    const sql = "SELECT * FROM terrains WHERE id_terrain = ?"; // Requête SQL pour récupérer le terrain
    db.query(sql, [terrainId], (err, result) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        if (result.length === 0) {
            return res.status(404).json({ error: "Terrain non trouvé" });
        }
        res.json(result[0]); // Retourner le terrain trouvé
    });
});


// Ajouter un nouveau terrain via une requête POST
app.post("/", verifierToken, verifierRole("admin"), (req, res) => {
    // Validation des données avec Joi
    const { error } = schemaCreationTerrain.validate(req.body);
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }
    const { nom, localisation, prix_par_science, description } = req.body;

    // Vérifier si un terrain identique existe déjà
    const checkSql = "SELECT * FROM terrains WHERE nom = ? AND localisation = ?";

    db.query(checkSql, [nom, localisation], (err, results) => {
        if (err) {
            console.error("Erreur lors de la vérification du terrain :", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length > 0) {
            return res.status(400).json({ error: "Un terrain avec ce nom et cette localisation existe déjà !" });
        }

        // Si le terrain n'existe pas, on l'ajoute
        const sql = "INSERT INTO terrains (nom, localisation, prix_par_science, description) VALUES (?, ?, ?, ?)";

        db.query(sql, [nom, localisation, prix_par_science, description], (err, result) => {
            if (err) {
                console.error("Erreur lors de l'ajout du terrain :", err);
                return res.status(500).json({ error: "Erreur lors de l'ajout du terrain" });
            }

            res.json({ message: "Terrain ajouté avec succès", terrainId: result.insertId });
        });
    });
});
// Modifier un terrain (seulement pour les admin)
app.put("/:id", verifierToken, verifierRole("gerant"), async (req, res) => {
    const terrainId = req.params.id;
    // Validation des données avec Joi
    const { error: idError } = schemaValidationId.validate({ id: terrainId });
    if (idError) {
        return res.status(400).json({ error: idError.details[0].message });
    }

    const { error } = schemaCreationTerrain.validate(req.body);
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }
    const { nom, prix_par_science, description, image } = req.body;
    const [rows] = await db.promise().query("SELECT * FROM terrains WHERE id_terrain = ?", [terrainId]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Terrain non trouvé" });
    }
    const checkSql = "SELECT * FROM terrains WHERE nom = ? AND localisation = ?";

    db.query(checkSql, [nom, localisation], (err, results) => {
        if (err) {
            console.error("Erreur lors de la vérification du terrain :", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length > 0) {
            return res.status(400).json({ error: "Un terrain avec ce nom et cette localisation existe déjà !" });
        }


        const sql = `
        UPDATE terrains 
        SET nom = ?, prix_par_science = ?, description = ?, image = ?
        WHERE id_terrain = ?
    `;

        db.query(sql, [nom, prix_par_science, description, image, terrainId], (err, result) => {
            if (err) {
                console.error("Erreur lors de la modification du terrain :", err);
                return res.status(500).json({ error: "Erreur lors de la mise à jour du terrain" });
            }
            res.json({ message: "Terrain mis à jour avec succès" });
        });
    });
});

// Supprimer un terrain (seulement pour les admins)
app.delete("/:id", verifierToken, verifierRole("admin"), async (req, res) => {
    const terrainId = req.params.id;
    const { error } = schemaValidationId.validate({ id: terrainId });
    if (error) {
        return res.status(400).json({ error: error.details[0].message });
    }
    // 🔍 Vérifier si l'utilisateur existe
    try {
        const [rows] = await db.promise().query("SELECT * FROM terrains WHERE id_terrain = ?", [terrainId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Terrain non trouvé" });
        }

        db.query("DELETE FROM terrains WHERE id_terrain = ?", [terrainId], (err, result) => {
            if (err) {
                console.error("Erreur lors de la suppression du terrain :", err);
                return res.status(500).json({ error: "Erreur lors de la suppression du terrain" });
            }
            res.json({ message: "Terrain supprimé avec succès" });
        });
    }
    catch (err) {
        console.error("Erreur lors de la suppression de terrain :", err);
        res.status(500).json({ error: "Erreur serveur lors de la suppression de terrain" });
    }
});

// Exporter le router pour qu'il soit accessible dans d'autres fichiers
module.exports = app;

