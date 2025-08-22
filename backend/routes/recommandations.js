const express = require('express'); // Importer le module Express
const router = express.Router(); // Créer un routeur Express
const db = require('../config/dbRecommendation'); // Importer la connexion à la base de données MySQL
const db2 = require('../config/db'); // Importer la connexion à la base de données MySQL
const Joi = require('joi'); // Importer Joi
require('dotenv').config();
// 📌 Fonction générique pour exécuter des requêtes SQL avec async/await
const executeQuery = (query, params = []) => {
    return new Promise((resolve, reject) => {
        db2.query(query, params, (err, results) => {
            if (err) reject(err);
            else resolve(results);
        });
    });
};


// ---------------------------- Schémas de validation ----------------------------

// Validation de l'ID utilisateur
const shemaValidationId = Joi.object({
    id: Joi.number().integer().positive().required()
});
router.get("/terrains-populaires", async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT 
                terrains.id_terrain, 
                terrains.nom, 
                terrains.localisation, 
                terrains.description,
                terrains.prix_par_science, 
                terrains.image,
                COUNT(reservations.id_reservation) AS nombre_reservations
            FROM terrains
            LEFT JOIN reservations 
            ON terrains.id_terrain = reservations.id_terrain
            GROUP BY terrains.id_terrain
            ORDER BY nombre_reservations DESC
            LIMIT 6;

        `);

        res.status(200).json(result);
    } catch (err) {
        console.error("Erreur lors de la récupération des terrains populaires :", err.message);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Route pour récupérer des recommandations personnalisées
router.get("/recommandations-personnalisees/:id_utilisateur", async (req, res) => {
    try {
        const id_utilisateur = req.params.id_utilisateur; // Récupérer l'ID utilisateur depuis les paramètres

        // Validation de l'ID utilisateur
        const { error } = shemaValidationId.validate({ id: id_utilisateur });
        if (error) {
            return res.status(400).json({ error: "ID utilisateur invalide" });
        }

        // 1. Trouver les terrains que l'utilisateur a le plus réservés
        const [terrainsFrequents] = await db.query(`
            SELECT 
            terrains.id_terrain, 
            terrains.nom, 
            terrains.localisation, 
            terrains.description,
            terrains.prix_par_science, 
            terrains.image,
                COUNT(reservations.id_reservation) AS nombre_reservations
            FROM terrains
            JOIN reservations 
            ON terrains.id_terrain = reservations.id_terrain
            WHERE reservations.id_utilisateur = ?
            GROUP BY terrains.id_terrain
            ORDER BY nombre_reservations DESC
            LIMIT 5;
        `, [id_utilisateur]);

        // 2. Trouver des terrains similaires en termes de localisation
        let terrainsSimilaires = [];
        if (terrainsFrequents.length > 0) {
            // Extraire les localisations des terrains réservés fréquemment
            const localisations = terrainsFrequents.map(terrain => terrain.localisation);

            // Trouver des terrains qui ont la même localisation mais que l'utilisateur n'a pas encore réservés
            [terrainsSimilaires] = await db.query(`
                SELECT 
                terrains.id_terrain, 
                terrains.nom, 
                terrains.localisation, 
                terrains.description,
                terrains.prix_par_science, 
                terrains.image
                FROM terrains
                WHERE localisation IN (?) 
                AND id_terrain NOT IN (
                    SELECT id_terrain 
                    FROM reservations 
                    WHERE id_utilisateur = ?
                )
                LIMIT 5;
            `, [localisations, id_utilisateur]);
        }

        // 3. Combiner les résultats et les renvoyer au client
        res.status(200).json({
            recommandations_frequentes: terrainsFrequents,
            recommandations_similaires: terrainsSimilaires
        });
    } catch (err) {
        console.error("Erreur lors de la récupération des recommandations personnalisées :", err.message);
        res.status(500).json({ message: "Erreur serveur." });
    }
});
router.get('/globales', async (req, res) => {
    try {
        const [result] = await db.query(`
            SELECT 
                t.id_terrain, 
                t.nom, 
                t.localisation, 
                t.description,
                t.prix_par_science, 
                t.image,
                COUNT(r.id_reservation) AS nombre_reservations 
            FROM 
                terrains t
            LEFT JOIN 
                reservations r 
            ON 
                r.id_terrain = t.id_terrain AND r.statut = 'Confirmée'
            GROUP BY 
                t.id_terrain
            ORDER BY 
                nombre_reservations DESC
            LIMIT 5;
        `);

        res.status(200).json(result);
    } catch (error) {
        console.error('Erreur lors de la récupération des terrains populaires:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Cette route recommande des terrains ayant des caractéristiques similaires à ceux préférés de l'utilisateur,
router.get("/recommandations-horaires/:id_utilisateur", async (req, res) => {
    try {
        const id_utilisateur = req.params.id_utilisateur;

        // 1. Valider l’ID utilisateur
        const { error } = shemaValidationId.validate({ id: id_utilisateur });
        if (error) {
            return res.status(400).json({ error: "ID utilisateur invalide" });
        }

        // 2. Obtenir les 3 horaires (heure:min) les plus souvent réservés par l'utilisateur
        const [heuresPref] = await db.query(`
            SELECT 
                DATE_FORMAT(heure_debut, '%H:%i') AS heure
            FROM reservations
            WHERE id_utilisateur = ?
            GROUP BY heure
            ORDER BY COUNT(*) DESC
            LIMIT 3
        `, [id_utilisateur]);

        if (heuresPref.length === 0) {
            return res.status(200).json([]); // Pas de données de réservation
        }

        const heures = heuresPref.map(h => h.heure); // ex: "09:30", "18:00", etc.

        // 3. Trouver les terrains disponibles à ces horaires aujourd’hui
        const terrainsDisponibles = [];

        for (let heure of heures) {
            const [terrains] = await db.query(`
                SELECT DISTINCT 
                    t.id_terrain, 
                    t.nom, 
                    t.localisation, 
                    t.description, 
                    t.prix_par_science,
                    t.image
                FROM terrains t
                WHERE NOT EXISTS (
                    SELECT 1 
                    FROM reservations r
                    WHERE r.id_terrain = t.id_terrain
                    AND DATE_FORMAT(r.heure_debut, '%H:%i') = ?
                    AND r.statut = 'Confirmée'
                    AND DATE(r.date_reservation) = CURDATE()
                )
            `, [heure]);

            // Ajouter l’horaire dans chaque terrain trouvé
            for (let terrain of terrains) {
                const terrainExist = terrainsDisponibles.find(t => t.id_terrain === terrain.id_terrain);

                if (!terrainExist) {
                    terrainsDisponibles.push({
                        id_terrain: terrain.id_terrain,
                        nom: terrain.nom,
                        localisation: terrain.localisation,
                        description: terrain.description,
                        prix_par_science: terrain.prix_par_science,
                        image: terrain.image,
                        horaires_frequents: heure // ici on garde l'heure précise ex: "09:30"
                    });
                }
            }
        }

        // 4. Retourner les recommandations
        res.status(200).json(terrainsDisponibles);
    } catch (err) {
        console.error("Erreur lors de la récupération des recommandations horaires :", err.message);
        res.status(500).json({ message: "Erreur serveur." });
    }
});

// Route pour obtenir des recommandations d'heures populaires pour un utilisateur
router.get('/times/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    // Validation de l'ID utilisateur avec Joi
    const { error } = shemaValidationId.validate({ id: userId });
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    try {
        // Requête pour obtenir les réservations de l'utilisateur avec les heures correspondantes
        const [reservations] = await db.query(`
        SELECT heure_debut, heure_fin, COUNT(*) AS nombre_de_reservations
        FROM reservations
        WHERE id_utilisateur = ?
        GROUP BY heure_debut, heure_fin
        ORDER BY heure_debut
        LIMIT 5;
        `, [userId]);

        // Regroupement des heures pour éviter les chevauchements
        const popularTimes = [];
        reservations.forEach(reservation => {
            let startHour = reservation.heure_debut.slice(0, 5); // Prendre "HH:mm" (pas "HH:mm:ss")
            let endHour = reservation.heure_fin.slice(0, 5); // Prendre "HH:mm" (pas "HH:mm:ss")

            // Vérifier si la plage horaire existe déjà
            const existingTime = popularTimes.find(time => time.heure_debut === startHour && time.heure_fin === endHour);
            if (existingTime) {
                existingTime.nombre_de_reservations += reservation.nombre_de_reservations;
            } else {
                popularTimes.push({
                    heure_debut: startHour,
                    heure_fin: endHour,
                    nombre_de_reservations: reservation.nombre_de_reservations
                });
            }
        });

        // Trier les résultats d'abord par heure de début croissante, puis par nombre de réservations décroissant
        popularTimes.sort((a, b) => {
            if (a.heure_debut !== b.heure_debut) {
                return a.heure_debut.localeCompare(b.heure_debut);
            } else {
                return b.nombre_de_reservations - a.nombre_de_reservations;
            }
        });

        // Réponse au client
        res.json({
            user_id: userId,
            popular_times: popularTimes
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Une erreur est survenue lors de la récupération des données.' });
    }
});
// Route POST pour récupérer les terrains disponibles entre deux horaires
router.post('/terrains-disponibles', async (req, res) => {
    const { heure_debut, heure_fin, date } = req.body;

    if (!heure_debut || !heure_fin || !date) {
        return res.status(400).json({ error: "Les champs heure_debut, heure_fin et date sont requis." });
    }

    try {
        const [terrains] = await db.query(`
            SELECT 
                t.id_terrain,
                t.nom,
                t.localisation,
                t.prix_par_science,
                t.description,
                t.image
            FROM terrains t
            WHERE NOT EXISTS (
                SELECT 1 FROM reservations r
                WHERE r.id_terrain = t.id_terrain
                AND r.date_reservation = ?
                AND r.statut = 'Confirmée'
                AND (
                    (r.heure_debut < ? AND r.heure_fin > ?)
                    OR (r.heure_debut >= ? AND r.heure_debut < ?)
                    OR (r.heure_fin > ? AND r.heure_fin <= ?)
                )
            )
        `, [
            date,
            heure_fin,
            heure_debut,
            heure_debut,
            heure_fin,
            heure_debut,
            heure_fin
        ]);

        // Ajouter manuellement heure_debut à chaque terrain
        const terrainsAvecHoraire = terrains.map(terrain => ({
            ...terrain,
            horaires_frequents: heure_debut // ajouté à chaque objet
        }));

        return res.status(200).json({ terrains_disponibles: terrainsAvecHoraire });

    } catch (error) {
        console.error("Erreur lors de la recherche de terrains disponibles :", error.message);
        return res.status(500).json({ error: "Erreur serveur. Veuillez réessayer plus tard." });
    }
});



router.get('/weather', (req, res) => {

    // Appel de l'API OpenWeatherMap pour obtenir les données météo
    fetch(`https://api.openweathermap.org/data/2.5/weather?q=Monastir&appid=${process.env.WEATHER_API_KEY}`)
        .then(response => response.json()) // Récupérer les données JSON
        .then(data => {
            // Récupérer le type de météo
            const weather = data.weather[0].main;
            const temperature = data.main.temp - 273.15; // Conversion de la température de Kelvin à Celsius
            let message = '';
            let title = '';  // Titre court pour l'affichage
            let query = '';

            // Logique pour déterminer le type de terrain et message explicatif
            if (weather === 'Rain' || weather === 'Snow') {
                title = `Météo ${weather}: Préférer terrain couvert`;
                query = `
                    SELECT  id_terrain,
                    nom,
                    localisation,
                    prix_par_science,
                    description,
                    image
                    FROM terrains
                    WHERE description LIKE '%couvertes%'  -- Terrain avec couvertures
                `;
            } else if (weather === 'Clear' || weather === 'Clouds') {
                title = `Météo ${weather}: Terrain extérieur recommandé`;
                query = `
                    SELECT  id_terrain,
                    nom,
                    localisation,
                    prix_par_science,
                    description,
                    image
                    FROM terrains
                `;
            } else {
                title = `Météo incertaine: Consultez les prévisions`;
                query = `
                SELECT  id_terrain,
                nom,
                localisation,
                prix_par_science,
                description,
                image
                FROM terrains
                `;
            }

            // Exécuter la requête SQL pour obtenir les terrains
            db2.query(query, (err, results) => {
                if (err) return res.status(500).json({ error: err.message });

                // Retourner les résultats avec un message explicatif et un titre
                res.json({
                    title: title,  // Inclure le titre court
                    terrains: results
                });
            });
        })
        .catch(err => res.status(500).json({ error: err.message })); // Gestion des erreurs
});


// 📌 Route pour les recommandations basées sur le prix moyen de l'utilisateur
router.get('/price/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { error } = shemaValidationId.validate({ id: userId });
        if (error) return res.status(400).json({ error: "ID utilisateur invalide" });

        // Obtenir le prix moyen des terrains réservés par l'utilisateur
        const result = await executeQuery(`
            SELECT AVG(t.prix_par_science) AS prix_moyen
            FROM reservations r
            JOIN terrains t ON r.id_terrain = t.id_terrain
            WHERE r.id_utilisateur = ?;
        `, [userId]);

        const price = result[0]?.prix_moyen ? parseFloat(result[0].prix_moyen) : 0;
        if (price === 0) return res.status(404).json({ message: "Aucune réservation trouvée pour cet utilisateur." });

        const minPrice = price - 5;
        const maxPrice = price + 5;

        // Vérifier la validité des valeurs
        if (isNaN(minPrice) || isNaN(maxPrice)) {
            throw new Error("Erreur lors du calcul des prix recommandés.");
        }

        const terrains = await executeQuery(`
        SELECT id_terrain,
        nom,
        localisation,
        prix_par_science,
        description,
        image
        FROM terrains
        WHERE prix_par_science BETWEEN ? AND ?
        `, [minPrice, maxPrice]);

        res.json({
            title: "Nos recommandations à ~" + price.toFixed(2) + " Dt le créneau",
            terrains
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 📌 Route pour obtenir les recommandations basées sur les amis de l'utilisateur
router.get('/friends/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId, 10);
        const { error } = shemaValidationId.validate({ id: userId });
        if (error) return res.status(400).json({ error: "ID utilisateur invalide" });
        
        const results = await executeQuery(`
            SELECT 
            t.id_terrain,
            t.nom,
            t.localisation,
            t.prix_par_science,
            t.description,
            t.image
            FROM terrains t
            JOIN reservations r ON t.id_terrain = r.id_terrain
            WHERE r.id_utilisateur IN (
                SELECT id_utilisateur_2 FROM amis WHERE id_utilisateur_1 = ?
                )
                GROUP BY t.id_terrain
                LIMIT 5;
                `, [userId]);
                
                if (results.length === 0) {
            return res.status(404).json({ message: "Aucun terrain recommandé sur la base des réservations de vos amis." });
        }
        
        res.json({
            title: "Terrains populaires chez vos amis",
            terrains: results
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 📌 Route pour obtenir les recommandations basées sur les évaluations des utilisateurs
router.get('/ratings', async (req, res) => {
    try {
        const results = await executeQuery(`
            SELECT t.id_terrain, t.nom, t.localisation, COALESCE(AVG(a.note), 0) AS note_moyenne
            FROM terrains t
            LEFT JOIN avis a ON t.id_terrain = a.id_terrain
            GROUP BY t.id_terrain
            HAVING note_moyenne >= 9.0
            ORDER BY note_moyenne DESC
            LIMIT 5;
            `);
            
            if (results.length === 0) {
                return res.status(404).json({ message: "Aucun terrain recommandé sur la base des avis des utilisateurs." });
        }
        
        res.json({
            message: "Voici les terrains les mieux notés par les utilisateurs (note ≥ 9.0) :",
            recommendations: results.map(terrain => ({
                id: terrain.id_terrain,
                nom: terrain.nom,
                localisation: terrain.localisation,
                note_moyenne: Number(terrain.note_moyenne).toFixed(1)
            }))
        });
        
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});




// Route pour obtenir des recommandations basées sur l'apprentissage machine
router.post('/ml/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId, 10);
    const { error } = shemaValidationId.validate({ id: userId });
    
    if (error) {
        return res.status(400).json({ error: "ID utilisateur invalide" });
    }

    try {
        const response = await fetch('http://127.0.0.1:5000/recommend', {
            method: 'POST',
            body: JSON.stringify({ userId }),
            headers: { 'Content-Type': 'application/json' }
        });

        const terrains = await response.json();
        res.json(terrains);
    } catch (err) {
        console.log(err)
        res.status(500).json({ error: err.message });
    }
});






// 📌 Route pour récupérer les promotions actuelles
router.get('/promotions', async (req, res) => {
    try {
        const results = await executeQuery(`
            SELECT 
            t.id_terrain, 
            t.nom, 
            t.localisation, 
            t.prix_par_science, 
            p.reduction, 
            p.description, 
            p.date_debut, 
            p.date_fin
            FROM terrains t
            JOIN promotions p ON t.id_terrain = p.id_terrain
            WHERE p.date_debut <= CURDATE() AND p.date_fin >= CURDATE();
            `);

        if (results.length === 0) {
            return res.status(404).json({ message: "Aucune promotion en cours pour le moment." });
        }

        const promotions = results.map(terrain => ({
            id: terrain.id_terrain,
            nom: terrain.nom,
            localisation: terrain.localisation,
            prix_initial: Number(terrain.prix_par_science).toFixed(2) + "€",
            reduction: terrain.reduction + "%",
            prix_promotionnel: (Number(terrain.prix_par_science) * (1 - terrain.reduction / 100)).toFixed(2) + "€",
            description: terrain.description,
            periode: `Du ${new Date(terrain.date_debut).toLocaleDateString()} au ${new Date(terrain.date_fin).toLocaleDateString()}`
        }));

        res.json({ message: "Voici les terrains en promotion :", promotions });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// router.get("/recommandations-similaires/:id_utilisateur", async (req, res) => {
module.exports = router; // Exporter le routeur  
// Cette route recommande des créneaux horaires en fonction des habitudes de réservation de l'utilisateur.
    //     try {
        //         const id_utilisateur = req.params.id_utilisateur;
        
//         // Validation de l'ID utilisateur avec Joi
//         const { error } = shemaValidationId.validate({ id: id_utilisateur });
//         if (error) {
//             return res.status(400).json({ error: "ID utilisateur invalide" });
//         }

//         // Trouver les localisations des terrains que l'utilisateur a déjà réservés
//         const [localisations] = await db.query(`
//             SELECT DISTINCT t.localisation
//             FROM reservations r
//             JOIN terrains t ON r.id_terrain = t.id_terrain
//             WHERE r.id_utilisateur = ?;
//         `, [id_utilisateur]);

//         if (localisations.length === 0) {
//             return res.status(200).json({ message: "Aucune recommandation disponible." });
//         }

//         const localisationList = localisations.map(loc => loc.localisation);

//         // Trouver les terrains dans ces localisations que l'utilisateur n'a pas encore réservés
//         const [terrainsSimilaires] = await db.query(`
//             SELECT
//                 t.id_terrain,
//                 t.nom,
//                 t.localisation,
//                 t.prix_par_science,
//                 t.description
//             FROM terrains t
//             WHERE t.localisation IN (?)
//             AND t.id_terrain NOT IN (
//                 SELECT r.id_terrain
//                 FROM reservations r
//                 WHERE r.id_utilisateur = ?
//             )
//             LIMIT 5;
//         `, [localisationList, id_utilisateur]);

//         res.status(200).json(terrainsSimilaires);
//     } catch (err) {
//         console.error("Erreur lors de la récupération des recommandations similaires :", err.message);
//         res.status(500).json({ message: "Erreur serveur." });
//     }
// });