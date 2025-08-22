
// Importation d'Express pour créer un routeur dédié aux routes d'authentification
const express = require('express');
// Création d'un routeur pour gérer les endpoints d'authentification
const app = express.Router();

// Importation de la connexion à la base de données (config/db.js)
const db = require('../config/db');
const db2 = require('../config/dbRecommendation');
// Importation de bcrypt pour hacher et comparer les mots de passe
const bcrypt = require('bcrypt');
// Importation de jsonwebtoken pour générer et vérifier les tokens JWT
const jwt = require('jsonwebtoken');

// Charger les variables d'environnement (cela charge le contenu du fichier .env)
// Assure-toi d'avoir déjà installé et configuré le module dotenv dans ton projet.
require('dotenv').config();
const verifierToken = require("../middlewares/verifierToken"); // Importation du middleware
const verifierRole = require("../middlewares/verifierRole");
const { schemaCreationReservation, schemaModificationReservation, schemaValidationId } = require('../validations/reservationValidation');

//Les reservations

// Endpoint POST : Ajouter une nouvelle réservation
app.post("/", verifierToken, (req, res) => {
    // Validation des données avec Joi
    const { error } = schemaCreationReservation.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { id_terrain, date_reservation, heure_debut } = req.body;

    // 🕒 Calcul automatique de heure_fin (+1h30)
    const [h, m] = heure_debut.split(":").map(Number);
    const dateObj = new Date(Date.UTC(2000, 0, 1, h, m)); // Date arbitraire
    dateObj.setMinutes(dateObj.getMinutes() + 90); // Ajouter 1h30

    const heure_fin = dateObj.toISOString().split("T")[1].substring(0, 8); // Format HH:mm:ss

    // Vérifier si une réservation identique existe déjà
    const checkSql = `
        SELECT * FROM reservations 
        WHERE id_terrain = ? 
        AND date_reservation = ? 
        AND heure_debut = ? 
        AND heure_fin = ?
    `;

    db.query(checkSql, [id_terrain, date_reservation, heure_debut, heure_fin], (err, results) => {
        if (err) {
            console.error("Erreur lors de la vérification de la réservation :", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length > 0) {
            return res.status(400).json({ error: "Cette réservation existe déjà !" });
        }

        // Récupérer le prix du terrain (prix_par_science)
        const getPrixSql = `SELECT prix_par_science FROM terrains WHERE id_terrain = ?`;
        db.query(getPrixSql, [id_terrain], (err, terrainResults) => {
            if (err) {
                console.error("Erreur lors de la récupération du prix du terrain :", err);
                return res.status(500).json({ error: "Erreur serveur" });
            }

            if (terrainResults.length === 0) {
                return res.status(404).json({ error: "Terrain non trouvé" });
            }

            // Calculer le montant basé sur le prix_par_science (prix par tranche de 1h)
            const prixParScience = terrainResults[0].prix_par_science;

            // Insérer la réservation avec heure_fin calculée et montant
            const sql = `
                INSERT INTO reservations (id_utilisateur, id_terrain, date_reservation, heure_debut, heure_fin, montant) 
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            db.query(sql, [req.user.id_utilisateur, id_terrain, date_reservation, heure_debut, heure_fin, prixParScience], (err, result) => {
                if (err) {
                    console.error("Erreur lors de l'ajout de la réservation :", err);
                    return res.status(500).json({ error: "Erreur lors de l'ajout de la réservation" });
                }

                res.json({
                    message: "Réservation ajoutée avec succès",
                    reservationId: result.insertId,
                    heure_fin_calculée: heure_fin,
                    montant: prixParScience // Inclure le montant dans la réponse
                });
            });
        });
    });
});

// Endpoint POST : Ajouter une nouvelle réservation
app.post("/admin", verifierToken, verifierRole("admin"), (req, res) => {
    const { error } = schemaCreationReservation.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });
    const { id_utilisateur, id_terrain, date_reservation, heure_debut, heure_fin } = req.body;
    // Vérifier si une réservation identique existe déjà
    const checkSql = `
        SELECT * FROM reservations 
        WHERE  id_terrain = ? 
        AND date_reservation = ? 
        AND heure_debut = ? 
        AND heure_fin = ?
    `;

    db.query(checkSql, [id_terrain, date_reservation, heure_debut, heure_fin], (err, results) => {
        if (err) {
            console.error("Erreur lors de la vérification de la réservation :", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length > 0) {
            return res.status(400).json({ error: "Cette réservation existe déjà !" });
        }

        // Si la réservation n'existe pas, on l'ajoute
        const sql = "INSERT INTO reservations (id_utilisateur, id_terrain, date_reservation, heure_debut, heure_fin) VALUES (?, ?, ?, ?, ?)";

        db.query(sql, [id_utilisateur, id_terrain, date_reservation, heure_debut, heure_fin], (err, result) => {
            if (err) {
                console.error("Erreur", err);
                return res.status(500).json({ error: "Erreur lors de l'ajout de la réservation" });
            }

            res.json({ message: "Réservation ajoutée avec succès", reservationId: result.insertId });
        });
    });
});

app.get("/utilisateur/:id", verifierToken, (req, res) => {
    const userId = req.params.id;
    const { error } = schemaValidationId.validate({ id: userId });
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }
    console.log("Utilisateur connecté:", req.user); // Vérifier si req.user est bien défini

    // 🛠 Vérification des droits d'accès
    if (req.user.role !== "admin" && req.user.id_utilisateur != userId) {
        return res.status(403).json({ error: "Accès refusé : vous ne pouvez voir que vos propres réservations" });
    }

    // 🛠 Modification de la requête pour trier les réservations par date décroissante
    db.query(
        `SELECT r.id_reservation,r.id_terrain,r.id_utilisateur, r.date_reservation, r.heure_debut, r.heure_fin, r.montant, r.statut, t.nom AS terrain_nom 
        FROM reservations r 
        JOIN terrains t ON r.id_terrain = t.id_terrain 
        WHERE r.id_utilisateur = ? 
        ORDER BY r.date_reservation DESC;`,
        [req.params.id],
        (err, results) => {
            if (err) {
                console.error("Erreur", err);
                return res.status(500).json({ error: "Erreur serveur" });
            }
            res.json(results);
        }
    );
});


// 📌 Un admin ou un gérant peut voir les réservations d'un terrain
app.get("/terrain/:terrainId", verifierToken, verifierRole("admin", "gerant"), (req, res) => {
    const terrainId = req.params.terrainId;
    // Validation de l'ID terrain
    const { error } = schemaValidationId.validate({ id: terrainId });
    if (error) {
        return res.status(400).json({ error: "ID terrain invalide" });
    }

    db.query("SELECT r.id_reservation,r.id_terrain,r.id_utilisateur, r.date_reservation, r.heure_debut, r.heure_fin, r.montant, r.statut, t.nom AS terrain_nom FROM reservations r JOIN terrains t ON r.id_terrain = t.id_terrain WHERE r.id_terrain = ? ORDER BY r.date_reservation DESC;", [req.params.terrainId], (err, results) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        res.json(results);
    });
});
// 📌 Route pour récupérer les terrains disponibles pour une date donnée
app.get("/terrains-disponibles", async (req, res) => {
    try {
        const { date } = req.query;

        if (!date) {
            return res.status(400).json({ error: "La date est requise." });
        }

        // ✅ Récupérer tous les terrains
        const terrainsQuery = `
            SELECT id_terrain, nom, localisation, prix_par_science, description 
            FROM terrains
        `;
        const [terrains] = await db.promise().query(terrainsQuery);

        // ✅ Récupérer toutes les réservations pour la date donnée avec statut "Confirmée" ou "En attente"
        const reservationsQuery = `
            SELECT id_terrain, heure_debut, heure_fin 
            FROM reservations 
            WHERE date_reservation = ? 
            AND statut IN ('Confirmée', 'En attente')  -- Exclure les réservations annulées
        `;
        const [reservations] = await db.promise().query(reservationsQuery, [date]);

        // ✅ Générer les créneaux horaires de 1h30 entre 08h00 et 00h00
        const horaires = [];
        let heure = 8; // Début à 08h00

        while (heure < 24) {
            const heureDebut = `${Math.floor(heure).toString().padStart(2, "0")}:${((heure % 1) * 60).toString().padStart(2, "0")
                }:00`;

            const heureFin = `${Math.floor(heure + 1.5).toString().padStart(2, "0")}:${(((heure + 1.5) % 1) * 60).toString().padStart(2, "0")
                }:00`;

            horaires.push({ heureDebut, heureFin });

            heure += 1.5; // Ajouter 1h30 à l'heure actuelle
        }

        // ✅ Associer les disponibilités aux terrains
        const terrainsDisponibles = terrains.map((terrain) => {
            // Récupérer les réservations de ce terrain
            const reservationsTerrain = reservations.filter(r => r.id_terrain === terrain.id_terrain);

            // Filtrer les créneaux pour retirer ceux qui sont déjà réservés
            const horairesLibres = horaires.filter(horaire =>
                !reservationsTerrain.some(r =>
                    r.heure_debut === horaire.heureDebut || r.heure_fin === horaire.heureFin
                )
            );

            return {
                ...terrain,
                disponibilites: horairesLibres,
            };
        });

        res.json(terrainsDisponibles);
    } catch (error) {
        console.error("Erreur lors de la récupération des terrains :", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});


// Endpoint PUT : Mettre à jour une réservation existante
app.put("/:reservationId", verifierToken, (req, res) => {
    const reservationId = req.params.reservationId;
    // Validation des données avec Joi
    const { error } = schemaModificationReservation.validate(req.body);
    if (error) return res.status(400).json({ error: "bbb" + error.details[0].message });
    const { date_reservation, heure_debut, heure_fin } = req.body;

    // 🔍 Vérifier que la réservation appartient bien à l'utilisateur
    const checkSql = "SELECT id_utilisateur FROM reservations WHERE id_reservation = ?";
    db.query(checkSql, [reservationId], (err, results) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "Réservation non trouvée" });
        }

        // 🛑 Vérifier si l'utilisateur est le propriétaire de la réservation
        if (req.user.role !== "admin" && req.user.role !== "gerant" && req.user.id_utilisateur !== results[0].id_utilisateur) {
            return res.status(403).json({ error: "Accès refusé : Vous ne pouvez modifier que vos propres réservations" });
        }

        // ✅ Mise à jour de la réservation
        const updateSql = "UPDATE reservations SET date_reservation = ?, heure_debut = ?, heure_fin = ? WHERE id_reservation = ?";
        db.query(updateSql, [date_reservation, heure_debut, heure_fin, reservationId], (err, result) => {
            if (err) {
                console.error("Erreur", err);
                return res.status(500).json({ error: "Erreur lors de la mise à jour de la réservation" });
            }

            res.json({ message: "Réservation mise à jour avec succès" });
        });
    });
});


// Endpoint pour annuler une réservation (soft delete)
app.delete("/:reservationId", verifierToken, (req, res) => {
    const reservationId = req.params.reservationId;

    // ✅ Valider l'ID avec Joi
    const { error } = schemaValidationId.validate({ id: reservationId });
    if (error) {
        return res.status(400).json({ error: "ID de réservation invalide" });
    }

    // 🔍 Vérifier si la réservation existe et à qui elle appartient
    const checkSql = "SELECT id_utilisateur, statut FROM reservations WHERE id_reservation = ?";
    db.query(checkSql, [reservationId], (err, results) => {
        if (err) {
            console.error("Erreur de vérification :", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "Réservation non trouvée" });
        }

        const reservation = results[0];

        // ✅ S'assurer que seul le proprio, un gérant ou admin peut annuler
        if (
            req.user.role !== "admin" &&
            req.user.role !== "gerant" &&
            req.user.id_utilisateur !== reservation.id_utilisateur
        ) {
            return res.status(403).json({ error: "Accès refusé" });
        }

        // 🚫 Éviter de ré-annuler une réservation déjà annulée
        if (reservation.statut === "Annulée") {
            return res.status(400).json({ error: "Réservation déjà annulée" });
        }

        // ✅ Mise à jour du statut à 'Annulée'
        const updateSql = "UPDATE reservations SET statut = 'Annulée' WHERE id_reservation = ?";
        db.query(updateSql, [reservationId], (err, result) => {
            if (err) {
                console.error("Erreur de mise à jour :", err);
                return res.status(500).json({ error: "Erreur lors de l'annulation" });
            }

            return res.json({ message: "Réservation annulée avec succès" });
        });
    });
});

// Route pour récupérer les statistiques
app.get("/stats/:role/:id_utilisateur", async (req, res) => {
    try {
        const { role, id_utilisateur } = req.params; // Récupération des paramètres
        const currentYear = new Date().getFullYear();  // Récupérer l'année actuelle

        let stats = {};

        if (role === "utilisateur") {
            // Nombre de réservations confirmées de l'utilisateur pour l'année en cours
            const [userReservations] = await db2.execute(
                "SELECT COUNT(*) AS total, SUM(t.prix_par_science) AS total_revenue " +
                "FROM reservations r " +
                "JOIN terrains t ON r.id_terrain = t.id_terrain " +
                "WHERE r.id_utilisateur = ? AND r.statut = 'Confirmée' AND YEAR(r.date_reservation) = ?",
                [id_utilisateur, currentYear]
            );

            stats.reservations = userReservations[0].total;
            stats.revenue = userReservations[0].total_revenue || 0;
        } else if (role === "admin") {
            // Nombre total de réservations confirmées pour l'année en cours
            const [totalReservations] = await db2.execute(
                "SELECT COUNT(*) AS total " +
                "FROM reservations " +
                "WHERE statut = 'En attente' AND YEAR(date_reservation) = ?",
                [currentYear]
            );

            // Chiffre d'affaires total (somme des prix des terrains des réservations confirmées) pour l'année en cours
            const [totalRevenue] = await db2.execute(`
                SELECT SUM(t.prix_par_science) AS revenue 
                FROM reservations r 
                JOIN terrains t ON r.id_terrain = t.id_terrain 
                WHERE r.statut = 'En attente' AND YEAR(r.date_reservation) = ?
            `, [currentYear]);

            stats.reservations = totalReservations[0].total;
            stats.revenue = totalRevenue[0].revenue || 0;
        }

        res.json(stats);
    } catch (error) {
        console.error("Erreur API stats:", error);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

app.get('/status_reservation/:role/:id_utilisateur', async (req, res) => {
    const { role, id_utilisateur } = req.params;

    try {
        // Vérification du rôle et obtention des statistiques
        if (role === 'utilisateur') {
            // Statistiques pour un utilisateur
            const [totalReservations] = await db2.execute(
                "SELECT COUNT(*) AS total FROM reservations WHERE id_utilisateur = ?",
                [id_utilisateur]
            );

            const [pendingReservations] = await db2.execute(
                "SELECT COUNT(*) AS total FROM reservations WHERE id_utilisateur = ? AND statut = 'En attente'",
                [id_utilisateur]
            );

            const [confirmedReservations] = await db2.execute(
                "SELECT COUNT(*) AS total FROM reservations WHERE id_utilisateur = ? AND statut = 'Confirmée'",
                [id_utilisateur]
            );

            const [canceledReservations] = await db2.execute(
                "SELECT COUNT(*) AS total FROM reservations WHERE id_utilisateur = ? AND statut = 'Annulée'",
                [id_utilisateur]
            );

            return res.json({
                total: totalReservations[0].total,
                confirmed: confirmedReservations[0].total,
                pending: pendingReservations[0].total,
                canceled: canceledReservations[0].total,
            });
        }

        // Statistiques pour un admin
        if (role === 'admin') {
            const [totalReservations] = await db2.execute("SELECT COUNT(*) AS total FROM reservations");
            const [pendingReservations] = await db2.execute("SELECT COUNT(*) AS total FROM reservations WHERE statut = 'En attente'");
            const [confirmedReservations] = await db2.execute("SELECT COUNT(*) AS total FROM reservations WHERE statut = 'Confirmée'");
            const [canceledReservations] = await db2.execute("SELECT COUNT(*) AS total FROM reservations WHERE statut = 'Annulée'");

            return res.json({
                total: totalReservations[0].total,
                confirmed: confirmedReservations[0].total,
                pending: pendingReservations[0].total,
                canceled: canceledReservations[0].total,
            });
        }

        // Si le rôle n'est pas valide
        return res.status(400).json({ error: 'Rôle non valide' });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Une erreur est survenue lors de la récupération des statistiques' });
    }
});


// Exporter le router pour qu'il soit accessible dans d'autres fichiers
module.exports = app;
