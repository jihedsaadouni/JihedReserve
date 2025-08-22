
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
const { schemaCreationUtilisateur, schemaModificationRole, schemaValidationId } = require('../validations/reservationValidation');




// Endpoint GET pour récupérer les informations d'un utilisateur
app.get("/:userId", verifierToken, (req, res) => {
    const userId = req.params.userId;
    // Validation de l'ID utilisateur
    const { error } = schemaValidationId.validate({ id: userId });
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // 🔍 Seul un admin ou l'utilisateur lui-même peut voir ces infos
    if (req.user.role !== "admin" && req.user.id_utilisateur != userId) {
        return res.status(403).json({ error: "Accès refusé : vous ne pouvez voir que vos propres informations" });
    }

    const sql = "SELECT nom, email, telephone FROM utilisateurs WHERE id_utilisateur = ?";
    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur lors de la récupération de l'utilisateur" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }
        res.json(results[0]);
    });
});
// Endpoint GET pour récupérer les informations du Dashboard d'un utilisateur
app.get("/:userId/dashboard", verifierToken, (req, res) => {
    const userId = req.params.userId;
    // Validation de l'ID utilisateur
    const { error } = schemaValidationId.validate({ id: userId });
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // Seul un admin ou l'utilisateur lui-même peut voir son dashboard
    if (req.user.role !== "admin" && req.user.id_utilisateur != userId) {
        return res.status(403).json({ error: "Accès refusé : vous ne pouvez voir que votre propre dashboard" });
    }

    // Récupérer les informations du dashboard (par exemple, les réservations)
    const sql = `
        SELECT utilisateurs.id_utilisateur,utilisateurs.nom, utilisateurs.email, utilisateurs.telephone, 
            COUNT(reservations.id_reservation) AS total_reservations
        FROM utilisateurs
        LEFT JOIN reservations ON utilisateurs.id_utilisateur = reservations.id_utilisateur
        WHERE utilisateurs.id_utilisateur = ?
        GROUP BY utilisateurs.id_utilisateur;
    `;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur lors de la récupération du dashboard" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }
        res.json(results[0]);  // Retourner les informations du dashboard
    });
});


// 📌 Seuls les admins peuvent voir tous les utilisateurs
app.get("/", verifierToken, verifierRole("admin"), (req, res) => {
    db.query("SELECT id_utilisateur, nom, email, role FROM utilisateurs", (err, results) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }
        res.json(results);
    });
})

// Endpoint GET pour récupérer le nombre total de réservations d'un utilisateur
app.get("/reservations/count/:userId", verifierToken, (req, res) => {
    const userId = req.params.userId;

    // Validation de l'ID utilisateur
    const { error } = schemaValidationId.validate({ id: userId });
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // Seul un admin ou l'utilisateur lui-même peut voir ce nombre
    if (req.user.role !== "admin" && req.user.id_utilisateur != userId) {
        return res.status(403).json({ error: "Accès refusé : vous ne pouvez voir que vos propres réservations" });
    }

    const sql = `SELECT COUNT(id_reservation) AS total_reservations
                FROM reservations
                WHERE id_utilisateur = ? AND statut != 'Annulée'`;

    db.query(sql, [userId], (err, results) => {
        if (err) {
            console.error("Erreur", err);
            return res.status(500).json({ error: "Erreur lors de la récupération du nombre de réservations" });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }
        res.json({ total_reservations: results[0].total_reservations });
    });
});

// Endpoint GET : Calculer le montant déjà payé et le montant à payer
app.get("/montants/:id", verifierToken, (req, res) => {
    // Requête pour calculer le montant total payé pour les réservations "Confirmée"
    const sqlMontantPaye = `
        SELECT SUM(montant) AS totalPaye
        FROM reservations
        WHERE statut = 'Confirmée'
        AND id_utilisateur = ?;
    `;

    // Requête pour calculer le montant à payer pour les réservations "En attente"
    const sqlMontantAPayer = `
        SELECT SUM(montant) AS totalAPayer
        FROM reservations
        WHERE statut = 'En attente'
        AND id_utilisateur = ?;
    `;

    const userId = req.params.id;  // Récupérer l'ID utilisateur à partir du token (dépend du middleware de vérification)

    db.query(sqlMontantPaye, [userId], (err, resultPaye) => {
        if (err) {
            console.error("Erreur lors du calcul du montant payé :", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        db.query(sqlMontantAPayer, [userId], (err, resultAPayer) => {
            if (err) {
                console.error("Erreur lors du calcul du montant à payer :", err);
                return res.status(500).json({ error: "Erreur serveur" });
            }

            const montantDejaPaye = resultPaye[0].totalPaye || 0;  // Si aucun résultat, mettre 0
            const montantAPayer = resultAPayer[0].totalAPayer || 0;  // Si aucun résultat, mettre 0

            res.json({
                montant_deja_paye: montantDejaPaye,
                montant_a_payer: montantAPayer
            });
        });
    });
});



// Modifier les informations d'un utilisateur (lui-même ou par un admin)
app.put("/:id", verifierToken, async (req, res) => {
    const userId = req.params.id;
    // Validation de l'ID
    const { error: idError } = schemaValidationId.validate({ id: userId });
    if (idError) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // Validation des données envoyées dans le corps
    const { error: bodyError } = schemaCreationUtilisateur.validate(req.body);
    if (bodyError) {
        return res.status(400).json({ error: bodyError.details[0].message });
    }
    const { nom, telephone, email, mot_de_passe } = req.body;

    // Vérifier si l'utilisateur est bien l'admin ou lui-même
    if (req.user.role !== "admin" && req.user.id_utilisateur != userId) {
        return res.status(403).json({ error: "Accès refusé : Vous ne pouvez modifier que votre propre compte" });
    }

    // Mise à jour des informations de base
    let sql = "UPDATE utilisateurs SET nom = ?, telephone = ?, email = ? WHERE id_utilisateur = ?";
    let params = [nom, telephone, email, userId];

    // Si l'utilisateur veut changer son mot de passe
    if (mot_de_passe) {
        const hashedPassword = await bcrypt.hash(mot_de_passe, 10);
        sql = "UPDATE utilisateurs SET nom = ?, telephone = ?, email = ?, mot_de_passe = ? WHERE id_utilisateur = ?";
        params = [nom, telephone, email, hashedPassword, userId];
    }

    db.query(sql, params, (err, result) => {
        if (err) {
            console.error("Erreur lors de la mise à jour :", err);
            return res.status(500).json({ error: "Erreur lors de la mise à jour" });
        }
        res.json({ message: "Utilisateur mis à jour avec succès" },);
    });
});
// 📌 Route pour modifier le rôle d'un utilisateur (accessible uniquement aux admins)
app.put("/modifier-role/:id", verifierToken, verifierRole("admin"), async (req, res) => {
    const userId = req.params.id; // ID de l'utilisateur à modifier
    // Validation de l'ID
    const { error: idError } = schemaValidationId.validate({ id: userId });
    if (idError) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    // Validation du rôle
    const { error: roleError } = schemaModificationRole.validate(req.body);
    if (roleError) {
        return res.status(400).json({ error: "Rôle invalide." });
    }
    const { role } = req.body; // Nouveau rôle à attribuer

    // 📌 Vérifier que le rôle fourni est valide (uniquement "utilisateur" ou "gerant")
    const rolesAutorises = ["admin", "utilisateur", "gerant"];
    if (!rolesAutorises.includes(role)) {
        return res.status(400).json({ error: "Rôle invalide." });
    }

    try {
        // 🔍 Vérifier si l'utilisateur existe
        const [rows] = await db.promise().query("SELECT * FROM utilisateurs WHERE id_utilisateur = ?", [userId]);
        if (rows.length === 0) {
            return res.status(404).json({ error: "Utilisateur non trouvé" });
        }

        // 🔄 Mise à jour du rôle en base de données
        await db.promise().query("UPDATE utilisateurs SET role = ? WHERE id_utilisateur = ?", [role, userId]);

        res.json({ message: `Rôle de l'utilisateur modifié en '${role}' avec succès` });
    } catch (err) {
        console.error("Erreur lors de la mise à jour du rôle :", err);
        res.status(500).json({ error: "Erreur serveur lors de la modification du rôle" });
    }
});


// Supprimer un utilisateur (uniquement par un admin)
app.delete("/:id", verifierToken, verifierRole("admin"), async (req, res) => {
    const userId = req.params.id;
    // Validation de l'ID
    const { error } = schemaValidationId.validate({ id: userId });
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }
    // 🔍 Vérifier si l'utilisateur existe
    const [rows] = await db.promise().query("SELECT * FROM utilisateurs WHERE id_utilisateur = ?", [userId]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Utilisateur non trouvé" });
    }

    db.query("DELETE FROM utilisateurs WHERE id_utilisateur = ?", [userId], (err, result) => {
        if (err) {
            console.error("Erreur lors de la suppression :", err);
            return res.status(500).json({ error: "Erreur lors de la suppression" });
        }
        res.json({ message: "Utilisateur supprimé avec succès" });
    });
});

// 📌 GET /gerant/:gerantId/terrain-id → retourne seulement l'id_terrain du gérant
app.get("/gerant/:gerantId/terrain-id", verifierToken, verifierRole("admin", "gerant"), (req, res) => {
    const gerantId = req.params.gerantId;

    const { error } = schemaValidationId.validate({ id: gerantId });
    if (error) {
        return res.status(400).json({ error: "ID gérant invalide." });
    }
    // 🔍 Seul un admin ou le gerant lui-même peut voirid de terrain
    if (req.user.role !== "admin" && req.user.id_utilisateur != gerantId) {
        return res.status(403).json({ error: "Accès refusé : vous ne pouvez voir que vos propres informations" });
    }

    const sql = "SELECT id_terrain FROM terrains WHERE id_gerant = ?";
    db.query(sql, [gerantId], (err, results) => {
        if (err) {
            console.error("Erreur SQL:", err);
            return res.status(500).json({ error: "Erreur serveur" });
        }

        if (results.length === 0) {
            return res.status(404).json({ error: "Aucun terrain trouvé pour ce gérant." });
        }

        res.json({ id_terrain: results[0].id_terrain });
    });
});

module.exports = app;



