// Importation des modules nécessaires
const express = require('express');
const app = express.Router();
const moment = require("moment-timezone");
require('moment/locale/fr'); // Support de la langue française
// Importation de la connexion à la base de données (config/db.js)
const db = require('../config/dbRecommendation');  // Importer la connexion DB depuis db.js
// Assure-toi d'avoir déjà installé et configuré le module dotenv dans ton projet.
require('dotenv').config();
app.use(express.json());
const winston = require('winston'); // Pour la gestion des logs
const { isValidDate, isValidTime } = require("../utils/validation");
const axios = require("axios");



// Configuration des logs
const logger = winston.createLogger({
    level: "info",
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.Console({ format: winston.format.simple() })
    ]
});
var utilisateurId = null;
// Webhook pour recevoir l'ID utilisateur
app.post('/idUtilisateur', async (req, res) => {
    try {
        // Récupérer l'ID utilisateur envoyé
        utilisateurId = req.body.userId;

        if (!utilisateurId) {
            return res.status(400).json({ error: "L'ID utilisateur est requis." });
        }

        console.log("ID Utilisateur reçu :", utilisateurId);

        // Tu peux effectuer des actions avec l'ID utilisateur ici (par exemple, le loguer ou l'enregistrer)

        // Répondre sans envoyer d'informations supplémentaires
        res.status(200).send();  // Réponse vide ou juste un statut 200

    } catch (error) {
        console.error("Erreur dans le webhook:", error.message);
        res.status(500).send();  // Retourner une erreur en cas de problème
    }
});


// Webhook pour Dialogflow
app.post('/', async (req, res) => {
    console.log("****************************************************************************");
    const intentName = req.body.queryResult.intent.displayName;
    const parameters = req.body.queryResult.parameters;
    const now = moment().tz("Africa/Tunis");

    console.log("📌 Intent détecté :", intentName);
    console.log("📌 Date actuelle :", now.format("DD MMMM YYYY HH:mm"));

    let terrainChoisi = parameters["terrain"] || null;
    console.log("id : " + utilisateurId);
    let dateExacte = parameters["date-exacte"] || null;
    let dateSansTime = parameters["date-sans-time"] || null;
    let dateTimeParam = Array.isArray(parameters["date-time"]) ? parameters["date-time"][0] : parameters["date-time"] || null;
    let timeParam = parameters["time-reelle"] || null;
    let heureActuelle = parameters["heure_actuelle"] || null;
    let heureNouvelle = parameters["heure_nouvelle"] || null;
    let relativeDate = parameters["date_relative"] || null;
    let jourDate = parameters["jour-date"] || null;

    // Gestion des contextes et de l'état de la conversation
    if (intentName === "Demande de réservation") {
        return res.json({
            fulfillmentText: "À quelle date et heure souhaitez-vous réserver ?",
            outputContexts: [{
                name: `${req.body.session}/contexts/reservation-demande`,
                lifespanCount: 2
            }]
        });
    }
    // Intent "Fournir date et heure" pour gérer la date et l'heure
    else if (intentName === "Fournir date et heure") {
        console.log("📌 Paramètres reçus :", { dateExacte, dateSansTime, dateTimeParam, timeParam, relativeDate, jourDate });

        // Extraction de la date complète
        let { formattedDate, finalDate, error } = extraireDateComplete(dateSansTime, dateTimeParam, timeParam, relativeDate, jourDate, dateExacte);

        // Vérification de la validité de la date
        if (error) {
            console.error("⛔ Erreur lors de l'extraction de la date :", error);
            return res.json({
                fulfillmentText: "Désolé, je n'ai pas pu comprendre la date. Pouvez-vous reformuler votre demande avec une date plus précise ?"
            });
        }
        if (!dateExacte && !dateSansTime && !dateTimeParam && !relativeDate && !jourDate) {
            console.warn("⚠️ Aucun paramètre de date valide détecté.");
            return res.json({
                fulfillmentText: "Je n'ai pas reconnu la date. Pouvez-vous la reformuler clairement ? Par exemple : 'Demain à 18h' ou 'le 5 mai à midi'."
            });
        }

        if (!formattedDate || !finalDate) {
            console.warn("⚠️ La date extraite est invalide ou vide.");
            return res.json({
                fulfillmentText: "Je n'ai pas bien compris la date que vous souhaitez. Pourriez-vous préciser une date valide ?"
            });
        }

        console.log("✅ Date validée :", finalDate.format("YYYY-MM-DD HH:mm"));

        // Calcul de l'heure de fin en ajoutant 1h30 à l'heure donnée
        let heureFin = addOneHourAndHalf(finalDate.format("HH:mm"));

        return res.json({
            fulfillmentText: `Votre réservation est enregistrée pour le ${formattedDate}. À quel terrain souhaitez-vous réserver ?`,
            outputContexts: [{
                name: `${req.body.session}/contexts/date-heure-fournie`,
                lifespanCount: 2,
                parameters: {
                    "date": finalDate.format("YYYY-MM-DD"),
                    "time": finalDate.format("HH:mm")
                }
            }]
        });
    }



    // Intent "Choix du terrain" pour choisir le terrain
    else if (intentName === "Choix du terrain") {
        console.log("⚽ Traitement de l'intent : Choix du terrain");

        const contexts = req.body.queryResult.outputContexts || [];
        const dateHeureContexte = contexts.find(ctx => ctx.name.endsWith("/contexts/date-heure-fournie"));

        // Vérification de l'existence des paramètres dans le contexte
        const date = dateHeureContexte?.parameters?.["date"] || null;
        const time = dateHeureContexte?.parameters?.["time"] || null;
        let terrainChoisi = parameters["terrain"] || null;

        console.log("📌 Date extraite :", date);
        console.log("📌 Heure extraite :", time);
        console.log("📌 Terrain choisi :", terrainChoisi);

        if (!date || !time) {
            console.warn("⚠️ Informations de date et heure manquantes.");
            return res.json({
                fulfillmentText: "Je n'ai pas reçu les informations sur la date et l'heure. Pouvez-vous les fournir à nouveau ?",
                outputContexts: [{
                    name: `${req.body.session}/contexts/date-heure-fournie`,
                    lifespanCount: 2
                }]
            });
        }

        if (!terrainChoisi) {
            console.warn("⚠️ Aucune sélection de terrain.");
            return res.json({
                fulfillmentText: "Pouvez-vous préciser le terrain que vous souhaitez réserver ?",
                outputContexts: [{
                    name: `${req.body.session}/contexts/date-heure-fournie`,
                    lifespanCount: 2,
                    parameters: { "date": date, "time": time }
                }]
            });
        }

        const heureFin = addOneHourAndHalf(time);

        // Vérification de l'existence du terrain dans la base de données
        getTerrainIdByName(terrainChoisi).then(async (idTerrain) => {
            if (!idTerrain) {
                console.warn(`⚠️ Terrain "${terrainChoisi}" introuvable.`);
                const terrainsAlternatifs = await getTerrainsDisponibles(date, time, heureFin);

                return res.json({
                    fulfillmentText: `Le terrain "${terrainChoisi}" n'existe pas. Voici d'autres terrains disponibles à la même heure : ${terrainsAlternatifs.join(", ")}. Lequel préférez-vous ?`,
                    outputContexts: [{
                        name: `${req.body.session}/contexts/date-heure-fournie`,
                        lifespanCount: 2,
                        parameters: { "date": date, "time": time }
                    }]
                });
            }

            // Vérification de la disponibilité du terrain
            return testDisponibiliteDesTerrains(heureFin, terrainChoisi, date, time, res, req);
        }).catch(error => {
            console.error("⛔ Erreur lors de la récupération du terrain :", error);
            return res.json({
                fulfillmentText: "Une erreur est survenue lors de la vérification du terrain. Veuillez réessayer plus tard."
            });
        });
    }

    // Intent "Confirmation de réservation" pour finaliser la réservation
    else if (intentName === "Confirmation de réservation") {
        console.log("📌 Traitement de l'intent : Confirmation de réservation");

        const contexts = req.body.queryResult.outputContexts || [];
        const choixTerrainContexte = contexts.find(ctx => ctx.name.endsWith("/contexts/choix-terrain"));

        // Vérification de l'existence des paramètres dans le contexte
        const terrainChoisi = choixTerrainContexte?.parameters?.["terrain"] || null;
        const date = choixTerrainContexte?.parameters?.["date"] || null;
        const time = choixTerrainContexte?.parameters?.["time"] || null;

        console.log("📌 Terrain choisi :", terrainChoisi);
        console.log("📌 Date extraite :", date);
        console.log("📌 Heure extraite :", time);

        if (!date || !time) {
            console.warn("⚠️ Informations de date et heure manquantes.");
            return res.json({
                fulfillmentText: "Je n'ai pas reçu les informations sur la date et l'heure. Pouvez-vous les fournir à nouveau ?",
                outputContexts: [{
                    name: `${req.body.session}/contexts/date-heure-fournie`,
                    lifespanCount: 2
                }]
            });
        }

        if (!terrainChoisi) {
            console.warn("⚠️ Aucune sélection de terrain.");
            return res.json({
                fulfillmentText: "Pouvez-vous préciser le terrain que vous souhaitez réserver ?",
                outputContexts: [{
                    name: `${req.body.session}/contexts/date-heure-fournie`,
                    lifespanCount: 2,
                    parameters: { "date": date, "time": time }
                }]
            });
        }

        // Vérification de l'existence du terrain
        getTerrainIdByName(terrainChoisi).then(async (idTerrain) => {
            if (!idTerrain) {
                console.warn(`⚠️ Terrain "${terrainChoisi}" introuvable.`);
                return res.json({
                    fulfillmentText: `Le terrain "${terrainChoisi}" n'existe pas dans notre base de données. Pouvez-vous en choisir un autre ?`,
                    outputContexts: [{
                        name: `${req.body.session}/contexts/date-heure-fournie`,
                        lifespanCount: 2,
                        parameters: { "date": date, "time": time }
                    }]
                });
            }

            // Calcul de l'heure de fin
            const heureDebut = moment(`${date} ${time}`, "YYYY-MM-DD HH:mm");
            const heureFin = heureDebut.clone().add(1.5, 'hour');

            console.log("📌 Heure de début :", heureDebut.format("HH:mm"));
            console.log("📌 Heure de fin :", heureFin.format("HH:mm"));

            // Enregistrement de la réservation
            const query = `
                INSERT INTO reservations (id_utilisateur, id_terrain, date_reservation, heure_debut, heure_fin)
                VALUES (?, ?, ?, ?, ?)
            `;
            db.execute(query, [utilisateurId, idTerrain, date, heureDebut.format("HH:mm"), heureFin.format("HH:mm")])
                .then(() => {
                    console.log("✅ Réservation enregistrée avec succès.");
                    return res.json({
                        fulfillmentText: `Votre réservation pour le terrain ${terrainChoisi} le ${date} à ${time} a été confirmée.`
                    });
                })
                .catch(error => {
                    console.error("⛔ Erreur lors de l'enregistrement de la réservation :", error);
                    return res.json({
                        fulfillmentText: "Une erreur s'est produite lors de l'enregistrement de votre réservation. Veuillez réessayer plus tard."
                    });
                });

        }).catch(error => {
            console.error("⛔ Erreur lors de la récupération du terrain :", error);
            return res.json({
                fulfillmentText: "Une erreur est survenue lors de la vérification du terrain. Veuillez réessayer plus tard."
            });
        });
    }
    // Cet intent permet à l'utilisateur de réserver directement un terrain à une date et une heure précises.
    else if (intentName === "Reservation_directe") {
        console.log("📌 Intent: Reservation_directe");

        terrainChoisi = parameters["terrain"] || null;

        // Vérifier si la date et l'heure sont fournies
        if (!dateSansTime && !dateTimeParam && !timeParam && !relativeDate && !jourDate) {
            return res.json({ fulfillmentText: "Pouvez-vous me donner la date complète ainsi que le stade ?" });
        }

        // Extraction de la date complète
        let { formattedDate, finalDate, error } = extraireDateComplete(dateSansTime, dateTimeParam, timeParam, relativeDate, jourDate, dateExacte);
        if (!formattedDate) {
            return res.json({ fulfillmentText: "Je n'ai pas compris la date. Pouvez-vous reformuler votre demande ?" });
        }

        // Calcul de l'heure de fin de réservation
        const heureFin = addOneHourAndHalf(finalDate.format("HH:mm"));

        // Vérifier si le terrain est précisé
        if (!terrainChoisi) {
            return res.json({
                fulfillmentText: `Pouvez-vous préciser le terrain que vous souhaitez réserver à cette date : (${formattedDate}) ?`,
                outputContexts: [{
                    name: `${req.body.session}/contexts/date-heure-fournie`,
                    lifespanCount: 2,
                    parameters: {
                        "date": finalDate.format("YYYY-MM-DD"),
                        "time": finalDate.format("HH:mm")
                    }
                }]
            });
        }

        try {
            // Vérifier l'existence du terrain
            const idTerrain = await getTerrainIdByName(terrainChoisi);
            if (!idTerrain) {
                return res.json({ fulfillmentText: `Le terrain \"${terrainChoisi}\" n'a pas été trouvé dans notre base de données.` });
            }
            // Vérifier la disponibilité du terrain
            return testDisponibiliteDesTerrains(heureFin, terrainChoisi, finalDate.format("YYYY-MM-DD"), finalDate.format("HH:mm"), res, req);
        } catch (error) {
            console.error("Erreur lors de la récupération du terrain:", error);
            return res.json({ fulfillmentText: "Une erreur s'est produite lors de la vérification du terrain. Veuillez réessayer." });
        }
    }
    // Cet intent permet à l'utilisateur de demander les terrains disponibles à une date et une heure précises.
    else if (intentName === "Demande_disponibilite_terrains") {
        console.log("📌 Intent: Demande_disponibilite_terrains");

        // Vérification de la date et de l'heure
        if (!dateSansTime && !dateTimeParam && !timeParam && !relativeDate && !jourDate) {
            return res.json({ fulfillmentText: "Pouvez-vous préciser la date et l'heure pour vérifier la disponibilité des terrains ?" });
        }

        // Extraction de la date complète
        let { formattedDate, finalDate, error } = extraireDateComplete(dateSansTime, dateTimeParam, timeParam, relativeDate, jourDate, dateExacte);
        if (!finalDate) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });
        }

        // Calcul de l'heure de fin
        const heureFin = addOneHourAndHalf(finalDate.format("HH:mm"));

        try {
            // Récupérer les terrains disponibles
            const terrainsDisponibles = await getTerrainsDisponibles(finalDate.format("YYYY-MM-DD"), finalDate.format("HH:mm"), heureFin);


            if (terrainsDisponibles.length > 0) {
                return res.json({
                    fulfillmentText: `📅 Terrains disponibles le {${formattedDate}} : 🏟️ ${terrainsDisponibles.map(nom =>
                        `${nom} (🕓 ${finalDate.format("HH:mm")} à ${heureFin})`
                    ).join("\n\n  •  ")}  🔁 Lequel souhaitez-vous réserver ?`
                    , outputContexts: [{
                        name: `${req.body.session}/contexts/date-heure-fournie`,
                        lifespanCount: 4,
                        parameters: {
                            "date": finalDate.format("YYYY-MM-DD"),
                            "time": finalDate.format("HH:mm")
                        }
                    }]
                });
            } else {
                return res.json({
                    fulfillmentText: `Désolé, aucun terrain n'est disponible le ${formattedDate}. Souhaitez-vous choisir un autre créneau ?`,
                    outputContexts: [{
                        name: `${req.body.session}/contexts/reservation-demande`,
                        lifespanCount: 4
                    }]
                });
            }
        } catch (error) {
            console.error("Erreur lors de la récupération des terrains disponibles:", error);
            return res.json({ fulfillmentText: "Une erreur s'est produite lors de la vérification des disponibilités. Veuillez réessayer." });
        }
    }

    // 📌 Intent: Demande_dispo_sans_heure
    // Cet intent permet de connaître les terrains disponibles pour une journée entière, sans préciser d'heure spécifique.
    else if (intentName === "Demande_dispo_sans_heure") {
        console.log("📌 Intent: Demande_dispo_sans_heure");

        let { formattedDate, finalDate, error } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        if (!finalDate) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });
        }

        try {
            // Récupérer les terrains disponibles pour toute la journée
            const terrainsDisponibles = await getTerrainsDisponibles(finalDate.format("YYYY-MM-DD"), "00:00", "23:59");
            if (terrainsDisponibles.length === 0) {
                return res.json({ fulfillmentText: `Désolé, aucun terrain n'est disponible le ${formattedDate}. Voulez-vous essayer une autre date ?` });
            }

            // Récupérer les plages horaires disponibles pour chaque terrain
            let message = `Voici les disponibilités des terrains le \"${formattedDate}\" :\n\n`;
            for (let terrain of terrainsDisponibles) {
                const horaires = await getPlagesHorairesDisponibles(terrain, finalDate.format("YYYY-MM-DD"));
                message += `⚽ ${terrain} : [ ${horaires.data.length > 0 ? horaires.data.join(", ") : "Aucune disponibilité"} ]\n`;
            }

            message += "\nQuel terrain et quelle heure souhaitez-vous réserver ?";

            return res.json({
                fulfillmentText: message,
                outputContexts: [{
                    name: `${req.body.session}/contexts/date-stade-fournie`,
                    lifespanCount: 2,
                    parameters: { "date": finalDate.format("YYYY-MM-DD") }
                }]
            });
        } catch (error) {
            console.error("Erreur lors de la récupération des disponibilités:", error);
            return res.json({ fulfillmentText: "Une erreur s'est produite lors de la vérification des terrains. Veuillez réessayer." });
        }
    } else if (intentName === "Choix_Terrain_Heure") {
        let dateChoisi = req.body.queryResult.outputContexts.find(ctx => ctx.name.includes("date-stade-fournie"))?.parameters?.date; // Récupérer la date fournie
        // Extraction de la date complète
        let { formattedDate, finalDate, error } = extraireDateComplete(null, dateTimeParam, timeParam, null, null, null);
        if (error) {
            console.log("error : " + error);
        }
        // 2️⃣ Vérification des paramètres
        if (!terrainChoisi || !finalDate.format("HH:mm") || !dateChoisi) {
            return res.json({
                fulfillmentText: "Je n'ai pas bien compris votre choix. Pouvez-vous me redire quel terrain et quelle heure vous souhaitez réserver ?"
            });
        }

        // 3️⃣ Vérification de la disponibilité du terrain à cette heure
        let heureFin = addOneHourAndHalf(finalDate.format("HH:mm"));

        console.log("🕒 Heure début :", finalDate.format("HH:mm"));
        console.log("🕒 Heure fin :", heureFin);

        let estDisponible = await verifierDisponibiliteTerrain(terrainChoisi, dateChoisi, finalDate.format("HH:mm"), heureFin);

        // 4️⃣ Réponse en fonction de la disponibilité
        if (estDisponible) {
            return res.json({
                fulfillmentText: `✅ Le terrain "${terrainChoisi}" est disponible le "${dateChoisi}" de ${finalDate.format("HH:mm")} à ${heureFin}.\nVoulez-vous confirmer votre réservation ?`,
                outputContexts: [{
                    name: `${req.body.session}/contexts/choix-terrain`,
                    lifespanCount: 2,
                    parameters: { "terrain": terrainChoisi, "date": dateChoisi, "time": finalDate.format("HH:mm") }
                }]
            });
        } else {
            return res.json({
                fulfillmentText: `❌ Désolé, le terrain "${terrainChoisi}" n'est pas disponible à ${finalDate.format("HH:mm")}.\nEssayez une autre heure parmi les plages horaires disponibles.`
            });
        }
    }
    // Cette intent demande à l'utilisateur la date et l'heure de la réservation qu'il souhaite modifier
    else if (intentName === "demande_modification") {
        return res.json({
            fulfillmentText: "D'accord ! Pour quelle date et quelle heure actuelle est ta réservation ?",
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_infos_modif`,
                    lifespanCount: 2
                }
            ]
        });
    }
    else if (intentName === "demande_date_heure_modification") {

        // // Extraction de la dateRecent
        let { formattedDate: formattedDateDateRecent, finalDate: finalDateDateRecent } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        // Extraction de la heureActuelle 
        let { formattedDate: formattedDateHeureActuelle, finalDate: finalDateHeureActuelle } = extraireDateComplete(null, dateTimeParam, heureActuelle, null, null, null);
        if (!finalDateDateRecent || !finalDateHeureActuelle) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });
        }
        console.log(formattedDateDateRecent)
        console.log(formattedDateHeureActuelle)

        // // Vérifier si la réservation existe
        const reservation = await getReservationExistante(finalDateDateRecent.format("YYYY-MM-DD"), finalDateHeureActuelle.format("HH:mm"), utilisateurId);


        if (!reservation.success) {
            return res.json({
                fulfillmentText: `Je n’ai pas trouvé de réservation pour le ${finalDateDateRecent.format("YYYY-MM-DD")} à ${finalDateHeureActuelle.format("HH:mm")}. Peux-tu vérifier tes informations et réessayer ?`
            });
        }
        const terrainChoisi = await getTerrainNameById(reservation.data.terrain_id);


        // Si la réservation est trouvée, répondre à l'utilisateur
        return res.json({
            fulfillmentText: `Merci ! Tu as réservé pour le ${finalDateDateRecent.format("YYYY-MM-DD")} à ${finalDateHeureActuelle.format("HH:mm")}. Est-ce correct ? Si oui, a quel heure tu veux le deplacer ?`,
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_heure_nouvelle`,
                    lifespanCount: 2,
                    parameters: {
                        "terrain": terrainChoisi,
                        "date": finalDateDateRecent.format("YYYY-MM-DD"),
                        "time": finalDateHeureActuelle.format("HH:mm")
                    }
                }
            ]
        });
    }
    else if (intentName === "modifier_reservation_sans_heure") {
        // // Extraction de la dateRecent
        let { formattedDate, finalDate } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        if (!finalDate) {
            return res.json({ fulfillmentText: "La date  est invalide." });
        }
        console.log(finalDate.format("YYYY-MM-DD"))

        const reservation = await getReservationParDate(finalDate.format("YYYY-MM-DD"), utilisateurId);
        if (!reservation.success) {
            return res.json({ fulfillmentText: "Je n’ai trouvé aucune réservation pour cette date. Peux-tu vérifier tes informations ?" });
        }

        const terrainChoisi = await getTerrainNameById(reservation.data.id_terrain);
        return res.json({
            fulfillmentText: `Je vois que tu as une réservation à ${moment(reservation.data.heure_debut, "HH:mm:ss").format("HH:mm")} sur le terrain "${terrainChoisi}". À quelle heure veux-tu la déplacer ?`,
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_heure_nouvelle`,
                    lifespanCount: 2,
                    parameters: {
                        "terrain": terrainChoisi,
                        "date": finalDate.format("YYYY-MM-DD"),
                        "time": moment(reservation.data.heure_debut, "HH:mm:ss").format("HH:mm")
                    }
                }
            ]
        });
    }

    else if (intentName === "demande_nouvelle_heure_modification") {
        const contexts = req.body.queryResult.outputContexts || [];

        // Récupérer les informations de réservation de l'utilisateur depuis les contextes précédents
        const changementContexte = contexts.find(ctx => ctx.name.includes("en_attente_heure_nouvelle"));
        const dateReservation = changementContexte ? changementContexte.parameters["date"] : null;
        const heureActuelle = changementContexte ? changementContexte.parameters["time"] : null;
        const terrainChoisi = changementContexte ? changementContexte.parameters["terrain"] : null;

        if (!dateReservation || !heureActuelle) {
            return res.json({
                fulfillmentText: "Je n'ai pas pu récupérer les informations de la réservation. Peux-tu me les redire ?"
            });
        }

        // Extraction de la heureNouvelle 
        let { formattedDate: formattedDateHeureNouvellee, finalDate: finalDateHeureNouvelle } = extraireDateComplete(null, dateTimeParam, heureNouvelle, null, null, null);
        if (!finalDateHeureNouvelle) {
            return res.json({ fulfillmentText: "L'heure est invalide." });
        }

        // // Vérifier la disponibilité du créneau horaire
        const disponibilites = await getPlagesHorairesDisponibles(terrainChoisi, dateReservation);
        // Fonction pour vérifier si une heure est dans un intervalle
        const estDisponible = disponibilites.data.some(plage => {
            let [debut, fin] = plage.split(" - "); // Séparer l'heure de début et de fin
            return finalDateHeureNouvelle.format("HH:mm") >= debut && heureNouvelle <= fin;
        });

        if (!estDisponible) {
            return res.json({ fulfillmentText: `Désolé, le créneau de ${finalDateHeureNouvelle.format("HH:mm")} n'est pas disponible.` });
        }
        else {
            return res.json({
                fulfillmentText: `Ta réservation du ${dateReservation} est en entrain de modifiée de ${heureActuelle} à ${finalDateHeureNouvelle.format("HH:mm")},tu veux confirmer ?`,
                outputContexts: [{
                    name: `${req.body.session}/contexts/confirmation_modification`,
                    lifespanCount: 2,
                    parameters: {
                        "date": dateReservation,
                        "heureActuelle": heureActuelle,
                        "heureNouvelle": finalDateHeureNouvelle.format("HH:mm")
                    }
                }]
            });
        }

    }

    else if (intentName === "modifier_reservation") {

        // Extraction de la heureActuelle 
        let { formattedDate: formattedDateHeureActuelle, finalDate: finalDateHeureActuelle } = extraireDateComplete(null, dateTimeParam, heureActuelle, null, null, null);


        // Extraction de la heureNouvelle 
        let { formattedDate: formattedDateHeureNouvellee, finalDate: finalDateHeureNouvelle } = extraireDateComplete(null, dateTimeParam, heureNouvelle, null, null, null);

        // // Extraction de la dateRecent
        let { formattedDate: formattedDateDateRecent, finalDate: finalDateDateRecent } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        if (!finalDateDateRecent || !finalDateHeureActuelle || !finalDateHeureNouvelle) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });

        }


        // // Vérifier si la réservation existe
        const reservation = await getReservationExistante(finalDateDateRecent.format("YYYY-MM-DD"), finalDateHeureActuelle.format("HH:mm"), utilisateurId);

        if (!reservation.success) {
            return res.json({ fulfillmentText: "Je n’ai trouvé aucune réservation à cette date et heure. Vérifie tes informations et réessaie." });
        }

        const terrainChoisi = await getTerrainNameById(reservation.data.terrain_id);

        // // Vérifier la disponibilité du créneau horaire
        const disponibilites = await getPlagesHorairesDisponibles(terrainChoisi, finalDateDateRecent.format("YYYY-MM-DD"));
        // Fonction pour vérifier si une heure est dans un intervalle
        const estDisponible = disponibilites.data.some(plage => {
            let [debut, fin] = plage.split(" - "); // Séparer l'heure de début et de fin
            return finalDateHeureNouvelle.format("HH:mm") >= debut && heureNouvelle <= fin;
        });

        if (!estDisponible) {
            return res.json({ fulfillmentText: `Désolé, le créneau de ${finalDateHeureNouvelle.format("HH:mm")} n'est pas disponible.` });
        }
        else {
            return res.json({
                fulfillmentText: `Ta réservation du ${finalDateDateRecent.format("YYYY-MM-DD")} est en entrain de modifiée de ${finalDateHeureActuelle.format("HH:mm")} à ${finalDateHeureNouvelle.format("HH:mm")},tu veux confirmer ?`,
                outputContexts: [{
                    name: `${req.body.session}/contexts/confirmation_modification`,
                    lifespanCount: 2,
                    parameters: {
                        "date": finalDateDateRecent.format("YYYY-MM-DD"),
                        "heureActuelle": finalDateHeureActuelle.format("HH:mm"),
                        "heureNouvelle": finalDateHeureNouvelle.format("HH:mm")
                    }
                }]
            });
        }

    }
    else if (intentName === "confirmation_modification") {
        const contexts = req.body.queryResult.outputContexts || [];

        const modificationContexte = contexts.find(ctx => ctx.name.includes("confirmation_modification"));
        const date = modificationContexte ? modificationContexte.parameters["date"] : null;
        const heureActuelle = modificationContexte ? modificationContexte.parameters["heureActuelle"] : null;
        const heureNouvelle = modificationContexte ? modificationContexte.parameters["heureNouvelle"] : null;
        if (!modificationContexte || !modificationContexte.parameters) {
            return res.json({ fulfillmentText: "Je n’ai pas pu récupérer les informations de la réservation. Peux-tu les préciser à nouveau ?" });
        }
        // 3️⃣ Vérification de la disponibilité du terrain à cette heure
        let heureFin = addOneHourAndHalf(heureNouvelle);

        // // Modifier la réservation
        const modificationReussie = await modifierReservation(date, heureActuelle, heureNouvelle, heureFin, utilisateurId);

        if (modificationReussie.success) {
            return res.json({ fulfillmentText: `Ta réservation du ${date} a bien été modifiée de ${heureActuelle} à ${heureNouvelle}.` });
        } else {
            return res.json({ fulfillmentText: "Une erreur est survenue lors de la modification de la réservation. Réessaie plus tard." });
        }
    }

    else if (intentName === "voir_mes_reservations") {
        const reservationsUtilisateur = await getReservationsUtilisateur(utilisateurId);

        if (!reservationsUtilisateur.success) {
            return res.json({ fulfillmentText: reservationsUtilisateur.message });
        }

        let message = "📅 **Voici tes réservations :**\n";

        for (const res of reservationsUtilisateur.data) {
            let terrainChoisi = await getTerrainNameById(res.id_terrain);

            // 🔹 Formatage propre de la date et de l'heure
            let dateFormatee = moment(res.date_reservation).format("DD/MM/YYYY");
            let heureFormatee = moment(res.heure_debut, "HH:mm:ss").format("HH:mm");

            message += `- 🏟️ **${terrainChoisi}** le **${dateFormatee}** à **${heureFormatee}**\n`;
        }

        return res.json({ fulfillmentText: message });
    }
    else if (intentName === "demande_suppression") {
        return res.json({
            fulfillmentText: "D'accord ! Pour quelle date et quelle heure est ta réservation à annuler ?",
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_infos_suppression`,
                    lifespanCount: 2
                }
            ]
        });
    }
    else if (intentName === "demande_date_heure_suppression") {

        // Extraction des paramètres de date et heure
        let { formattedDate: formattedDateReservation, finalDate: finalDateReservation } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        let { formattedDate: formattedHeureReservation, finalDate: finalHeureReservation } = extraireDateComplete(null, dateTimeParam, timeParam, null, null, null);
        if (!finalDateReservation || !finalHeureReservation) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });
        }

        console.log(`Date de réservation : ${formattedDateReservation}`);
        console.log(`Heure de réservation : ${formattedHeureReservation}`);

        // Vérifier si la réservation existe
        const reservation = await getReservationExistante(finalDateReservation.format("YYYY-MM-DD"), finalHeureReservation.format("HH:mm"), utilisateurId);

        if (!reservation.success) {
            return res.json({
                fulfillmentText: `Je n’ai trouvé aucune réservation pour le ${finalDateReservation.format("YYYY-MM-DD")} à ${finalHeureReservation.format("HH:mm")}. Peux-tu vérifier les informations et réessayer ?`
            });
        }

        const terrainChoisi = await getTerrainNameById(reservation.data.terrain_id);

        // Demande confirmation avant suppression
        return res.json({
            fulfillmentText: `Tu as réservé un terrain (${terrainChoisi}) pour le ${finalDateReservation.format("YYYY-MM-DD")} à ${finalHeureReservation.format("HH:mm")}. Veux-tu vraiment annuler cette réservation ? Réponds par "oui" pour confirmer.`,
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_confirmation_suppression`,
                    lifespanCount: 2,
                    parameters: {
                        "terrain": terrainChoisi,
                        "date": finalDateReservation.format("YYYY-MM-DD"),
                        "time": finalHeureReservation.format("HH:mm")
                    }
                }
            ]
        });
    }
    else if (intentName === "demande_suppression_directe") {
        // Extraction des paramètres de la requête utilisateur
        let { formattedDate: formattedDateReservation, finalDate: finalDateReservation } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        let { formattedDate: formattedDateHeureReservation, finalDate: finalDateHeureReservation } = extraireDateComplete(null, dateTimeParam, timeParam, null, null, null);
        if (!finalDateReservation || !finalDateHeureReservation) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });
        }

        console.log("📅 Date demandée :", formattedDateReservation);
        console.log("⏰ Heure demandée :", formattedDateHeureReservation);

        // Vérification si la réservation existe
        const reservation = await getReservationExistante(finalDateReservation.format("YYYY-MM-DD"), finalDateHeureReservation.format("HH:mm"), utilisateurId);

        if (!reservation.success) {
            return res.json({
                fulfillmentText: `Je n’ai trouvé aucune réservation pour le ${finalDateReservation.format("YYYY-MM-DD")} à ${finalDateHeureReservation.format("HH:mm")}. Peux-tu vérifier tes informations et réessayer ?`
            });
        }
        const terrainChoisi = await getTerrainNameById(reservation.data.terrain_id);
        // Passer le contexte à l'intent de confirmation
        return res.json({
            fulfillmentText: `Tu veux supprimer ta réservation du ${finalDateReservation.format("YYYY-MM-DD")} à ${finalDateHeureReservation.format("HH:mm")}, peux-tu confirmer ?`,
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_confirmation_suppression`,
                    lifespanCount: 2,
                    parameters: {
                        "terrain": terrainChoisi,
                        "date": finalDateReservation.format("YYYY-MM-DD"),
                        "time": finalDateHeureReservation.format("HH:mm")
                    }
                }
            ]
        });
    }
    else if (intentName === "demande_suppression_sans_heure") {
        // Extraction de la date
        let { formattedDate, finalDate } = extraireDateComplete(dateSansTime, dateTimeParam, null, relativeDate, jourDate, dateExacte);
        if (!finalDate) {
            return res.json({ fulfillmentText: "une date ou l'heure est invalide." });
        }
        if (!finalDate) {
            return res.json({ fulfillmentText: "Date invalid !" });
        }

        // Recherche d'une réservation existante pour cette date
        const reservation = await getReservationParDate(finalDate.format("YYYY-MM-DD"), utilisateurId);

        // Si aucune réservation n'est trouvée
        if (!reservation.success) {
            return res.json({ fulfillmentText: "Je n’ai trouvé aucune réservation pour cette date. Peux-tu vérifier tes informations ?" });
        }

        // Si la réservation existe, récupérer le terrain choisi
        const terrainChoisi = await getTerrainNameById(reservation.data.id_terrain);

        // Demander à l'utilisateur si la suppression est correcte
        return res.json({
            fulfillmentText: `Je vois que tu as une réservation sur le terrain "${terrainChoisi}"  à ${moment(reservation.data.heure_debut, "HH:mm:ss").format("HH:mm")} à la date "${finalDate.format("YYYY-MM-DD")}" . Confirme-moi si tu veux vraiment supprimer cette réservation.`,
            outputContexts: [
                {
                    name: `${req.body.session}/contexts/en_attente_confirmation_suppression`,
                    lifespanCount: 2,
                    parameters: {
                        "terrain": terrainChoisi,
                        "date": finalDate.format("YYYY-MM-DD"),
                        "time": moment(reservation.data.heure_debut, "HH:mm:ss").format("HH:mm")
                    }
                }
            ]
        });
    }

    else if (intentName === "confirmation_suppression") {
        const contexts = req.body.queryResult.outputContexts || [];

        // 🔍 Recherche du contexte contenant les infos de la réservation
        const suppressionContexte = contexts.find(ctx => ctx.name.includes("en_attente_confirmation_suppression"));
        const date = suppressionContexte ? suppressionContexte.parameters["date"] : null;
        const heure = suppressionContexte ? suppressionContexte.parameters["time"] : null;
        const terrain = suppressionContexte ? suppressionContexte.parameters["terrain"] : null;

        if (!suppressionContexte || !suppressionContexte.parameters) {
            return res.json({ fulfillmentText: "Je n’ai pas pu récupérer les informations de la réservation. Peux-tu les préciser à nouveau ?" });
        }
        // 🗑️ Suppression de la réservation
        const suppressionReussie = await supprimerReservation(date, heure, utilisateurId);

        if (suppressionReussie.success) {
            return res.json({ fulfillmentText: `Ta réservation du ${date} à ${heure} sur le terrain '${terrain}' a bien été annulée.` });
        } else {
            return res.json({ fulfillmentText: "Une erreur est survenue lors de la suppression de la réservation. Réessaie plus tard." });
        }
    }
    else if (intentName === "recommandations_populaires") {
        try {
            const response = await axios.get("http://localhost:3000/api/recommandations/terrains-populaires");
            const terrainsPopulaires = response.data;

            if (terrainsPopulaires.length === 0) {
                return res.json({ fulfillmentText: "Aucun terrain populaire trouvé pour le moment." });
            }

            let messagePopulaires = "Voici les terrains les plus populaires :\n";
            terrainsPopulaires.forEach(terrain => {
                messagePopulaires += `- ${terrain.nom} à ${terrain.localisation}, Prix : ${terrain.prix_par_science} TND\n`;
            });

            return res.json({ fulfillmentText: messagePopulaires });

        } catch (err) {
            console.error("Erreur lors de la récupération des terrains populaires :", err.message);
            return res.json({ fulfillmentText: "Désolé, une erreur est survenue lors de la récupération des terrains populaires." });
        }
    }
    else if (intentName === "recommandations_personnalisées") {
        if (!utilisateurId) {
            return res.json({ fulfillmentText: "Je ne peux pas récupérer vos recommandations sans votre identifiant." });
        }

        const response = await axios.get(`http://localhost:3000/api/recommandations/recommandations-personnalisees/${utilisateurId}`);
        const data = response.data;
        // Vérification si `data` est bien récupéré
        if (!data || typeof data !== "object") {
            return res.json({ fulfillmentText: "Désolé, une erreur est survenue lors de la récupération de vos recommandations." });
        }

        let messagePersonnalise = "🎯 *Voici des terrains que vous aimez :*\n";
        if (data.recommandations_frequentes.length > 0) {
            data.recommandations_frequentes.forEach(terrain => {
                messagePersonnalise += `🏟️ *${terrain.nom}* - 📍 ${terrain.localisation} | 💰 ${terrain.prix_par_science} TND\n`;
            });
        } else {
            messagePersonnalise += "❌ Aucune réservation passée détectée.\n";
        }

        if (data.recommandations_similaires.length > 0) {
            messagePersonnalise += "\n🎯 *Terrains similaires à ceux que vous aimez :*\n";
            data.recommandations_similaires.forEach(terrain => {
                messagePersonnalise += `🏟️ *${terrain.nom}* - 📍 ${terrain.localisation} | 💰 ${terrain.prix_par_science} TND\n`;
            });
        }

        if (messagePersonnalise.trim() === "") {
            messagePersonnalise = "😞 Désolé, aucune recommandation personnalisée disponible pour le moment.";
        }

        return res.json({ fulfillmentText: messagePersonnalise });

    }
    else if (intentName === "recommandations_globales") {
        try {
            const response = await axios.get("http://localhost:3000/api/recommandations/globales");
            const terrainsPopulaires = response.data;

            if (!Array.isArray(terrainsPopulaires) || terrainsPopulaires.length === 0) {
                return res.json({ fulfillmentText: "Aucun terrain populaire trouvé pour le moment." });
            }

            let message = "🏆 *Voici les terrains les plus populaires :*\n\n";
            terrainsPopulaires.forEach((terrain, index) => {
                if (terrain.nom && terrain.nombre_reservations !== undefined) {
                    message += `🔹 *${index + 1}. ${terrain.nom}*\n`;
                    message += `   📅 Réservé ${terrain.nombre_reservations} fois\n`;
                    message += "-----------------------------------\n";
                }
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des terrains populaires :", err.message);
            return res.json({ fulfillmentText: "❌ Désolé, une erreur est survenue lors de la récupération des terrains populaires." });
        }
    }
    else if (intentName === "recommandations_horaires") {
        try {
            if (!utilisateurId) {
                return res.json({ fulfillmentText: "⚠️ Je ne peux pas récupérer vos recommandations sans votre identifiant." });
            }

            const response = await axios.get(`http://localhost:3000/api/recommandations/recommandations-horaires/${utilisateurId}`);
            const horaires = response.data;

            if (!Array.isArray(horaires) || horaires.length === 0) {
                return res.json({ fulfillmentText: "⏳ Aucune recommandation horaire disponible pour le moment." });
            }

            let message = "🕒 *Voici les horaires les plus populaires pour réserver :*\n\n";
            horaires.forEach((horaire, index) => {
                if (horaire.heure !== undefined && horaire.nombre_reservations !== undefined) {
                    message += `🔹 *${index + 1}. ${horaire.heure}h*\n`;
                    message += `   📅 Réservé ${horaire.nombre_reservations} fois\n`;
                    message += "-----------------------------------\n";
                }
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations horaires :", err.message);
            return res.json({ fulfillmentText: "❌ Désolé, une erreur est survenue lors de la récupération des recommandations horaires." });
        }
    }
    else if (intentName === "recommandations_similaires") {
        try {
            if (!utilisateurId) {
                return res.json({ fulfillmentText: "⚠️ Je ne peux pas récupérer vos recommandations sans votre identifiant." });
            }

            const response = await axios.get(`http://localhost:3000/api/recommandations/recommandations-similaires/${utilisateurId}`);
            const terrainsSimilaires = response.data;

            if (!Array.isArray(terrainsSimilaires) || terrainsSimilaires.length === 0) {
                return res.json({ fulfillmentText: "📭 Aucun terrain similaire trouvé." });
            }

            let message = "✨ *Voici des terrains similaires à ceux que vous aimez :*\n\n";
            terrainsSimilaires.forEach((terrain, index) => {
                if (terrain.nom && terrain.localisation && terrain.prix_par_science !== undefined) {
                    message += `🔹 *${index + 1}. ${terrain.nom}*\n`;
                    message += `   📍 Localisation : ${terrain.localisation}\n`;
                    message += `   💰 Prix : ${terrain.prix_par_science} TND\n`;
                    message += "-----------------------------------\n";
                }
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations similaires :", err.message);
            return res.json({ fulfillmentText: "❌ Désolé, une erreur est survenue lors de la récupération des recommandations similaires." });
        }
    }
    else if (intentName === "recommandations_meteo") {
        try {

            const response = await axios.get(`http://localhost:3000/api/recommandations/weather`);
            const data = response.data;

            let message = `🌤️ *Recommandations selon la météo à Monastir*\n\n`;
            message += `📌 ${data.message}\n\n`;

            if (Array.isArray(data.terrains) && data.terrains.length > 0) {
                message += "🏟️ *Terrains recommandés :*\n";
                data.terrains.forEach(terrain => {
                    message += `➖ *${terrain.nom}* 📍 ${terrain.localisation} 💰 ${terrain.prix_par_science} TND\n`;
                });
            } else {
                message += "⚠️ Aucun terrain spécifique recommandé pour cette météo.";
            }

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations météo :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des recommandations météo." });
        }
    }

    else if (intentName === "recommandations_prix") {
        try {
            if (!utilisateurId) {
                return res.json({ fulfillmentText: "Je ne peux pas récupérer vos recommandations sans votre identifiant." });
            }

            const response = await axios.get(`http://localhost:3000/api/recommandations/price/${utilisateurId}`);
            const data = response.data;

            let message = `💰 *Recommandations de terrains selon votre budget* \n\n`;
            message += `📌 ${data.message}\n\n`;

            if (Array.isArray(data.terrains) && data.terrains.length > 0) {
                message += "🏟️ *Terrains suggérés :*\n";
                data.terrains.forEach(terrain => {
                    message += `➖ *${terrain.nom}* 📍 ${terrain.localisation} 💰 ${terrain.prix_par_science} TND\n`;
                });
            } else {
                message += "⚠️ Aucun terrain trouvé dans votre gamme de prix.";
            }

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations basées sur le prix :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des recommandations par prix." });
        }
    }

    else if (intentName === "recommandations_times") {
        try {
            if (!utilisateurId) {
                return res.json({ fulfillmentText: "Je ne peux pas récupérer vos recommandations sans votre identifiant." });
            }

            const response = await axios.get(`http://localhost:3000/api/recommandations/times/${utilisateurId}`);
            const data = response.data;

            if (!Array.isArray(data.popular_times) || data.popular_times.length === 0) {
                return res.json({ fulfillmentText: "📌 Aucune recommandation horaire disponible pour le moment." });
            }

            let message = `⏰ *Horaires les plus populaires pour vos réservations*\n\n`;
            data.popular_times.forEach(time => {
                message += `➖ *${time.heure_debut} - ${time.heure_fin}* 🕒 (${time.nombre_de_reservations} réservations)\n`;
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations horaires :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des recommandations horaires." });
        }
    }
    else if (intentName === "recommandations_promotions") {
        try {
            const response = await axios.get(`http://localhost:3000/api/recommandations/promotions`);
            const data = response.data;

            if (!Array.isArray(data.promotions) || data.promotions.length === 0) {
                return res.json({ fulfillmentText: "📌 Aucune promotion en cours pour le moment." });
            }

            let message = "🔥 *Terrains en promotion* 🔥\n\n";
            data.promotions.forEach(terrain => {
                message += `🏟️ *${terrain.nom}* 📍 ${terrain.localisation}\n`;
                message += `💰 Prix initial : ${terrain.prix_initial}\n`;
                message += `🔻 Réduction : ${terrain.reduction}\n`;
                message += `💵 Nouveau prix : ${terrain.prix_promotionnel}\n`;
                message += `📅 Période : ${terrain.periode}\n\n`;
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des promotions :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des promotions." });
        }
    }

    else if (intentName === "recommandations_amis") {
        try {
            if (!utilisateurId) {
                return res.json({ fulfillmentText: "Je ne peux pas récupérer vos recommandations sans votre identifiant." });
            }

            const response = await axios.get(`http://localhost:3000/api/recommandations/friends/${utilisateurId}`);
            const data = response.data;

            if (!Array.isArray(data.recommandations) || data.recommandations.length === 0) {
                return res.json({ fulfillmentText: "📌 Aucun terrain recommandé sur la base des choix de vos amis." });
            }

            let message = "👥 *Terrains populaires parmi vos amis* 👥\n\n";
            data.recommandations.forEach(terrain => {
                message += `🏟️ *${terrain.nom}* 📍 ${terrain.localisation}\n`;
                message += `📊 Nombre de réservations : ${terrain.nombre_reservations}\n\n`;
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations des amis :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des recommandations basées sur vos amis." });
        }
    }

    else if (intentName === "recommandations_avis") {
        try {
            const response = await axios.get(`http://localhost:3000/api/recommandations/ratings`);
            const data = response.data;

            if (!Array.isArray(data.recommendations) || data.recommendations.length === 0) {
                return res.json({ fulfillmentText: "📌 Aucun terrain recommandé sur la base des avis des utilisateurs." });
            }

            let message = "⭐ *Terrains les mieux notés* ⭐\n\n";
            data.recommendations.forEach(terrain => {
                message += `🏟️ *${terrain.nom}* 📍 ${terrain.localisation}\n`;
                message += `🌟 Note moyenne : ${terrain.note_moyenne}/10\n\n`;
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations basées sur les avis :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des recommandations par avis." });
        }
    }

    else if (intentName === "recommandations_ml") {
        try {
            if (!utilisateurId) {
                return res.json({ fulfillmentText: "Je ne peux pas récupérer vos recommandations sans votre identifiant." });
            }

            const response = await axios.post(`http://localhost:3000/api/recommandations/ml/${utilisateurId}`);
            const data = response.data;

            // Vérification de la structure de data
            const terrains = data.recommended_fields || data; // Prend le bon tableau selon la structure réelle

            if (!Array.isArray(terrains) || terrains.length === 0) {
                return res.json({ fulfillmentText: "📌 Aucun terrain recommandé par l'algorithme pour le moment." });
            }

            let message = "🤖 *Recommandations intelligentes* 🤖\n\n";
            terrains.forEach(terrain => {
                message += `🏟️ *${terrain.field_name}* 💰 ${terrain.prix} DT\n\n`;
            });

            return res.json({ fulfillmentText: message });

        } catch (err) {
            console.error("Erreur lors de la récupération des recommandations par Machine Learning :", err.message);
            return res.json({ fulfillmentText: "❌ Une erreur est survenue lors de la récupération des recommandations intelligentes." });
        }
    }








    // Gérer d'autres intents ici si nécessaire

});
// Fonction pour supprimer une réservation
async function supprimerReservation(date, heure, utilisateurId) {
    try {
        // Log avec Winston
        winston.info(`Tentative de suppression pour l'utilisateur ${utilisateurId} à ${date} à ${heure}`);

        // Requête SQL pour supprimer la réservation
        const sql = `DELETE FROM reservations WHERE date_reservation = ? AND heure_debut = ? AND id_utilisateur = ?`;
        const [result] = await db.execute(sql, [date, heure, utilisateurId]);

        // Vérification si la suppression a bien eu lieu
        if (result.affectedRows > 0) {
            return { success: true, message: "Réservation supprimée avec succès." };
        } else {
            return { success: false, message: "La suppression a échoué. Veuillez réessayer." };
        }
    } catch (error) {
        // Log de l'erreur avec Winston
        winston.error(`Erreur lors de la suppression de la réservation : ${error.message}`);
        return { success: false, message: "Une erreur est survenue lors de la suppression de la réservation." };
    }
}
const getReservationsUtilisateur = async (userId) => {
    try {
        const query = `SELECT date_reservation, heure_debut, id_terrain FROM reservations WHERE id_utilisateur = ? ORDER BY date_reservation ASC`;
        const [rows] = await db.execute(query, [userId]);
        return rows.length > 0 ? { success: true, data: rows } : { success: false, message: "Aucune réservation trouvée." };
    } catch (error) {
        winston.error(`Erreur lors de la récupération des réservations de l'utilisateur ${userId} : ${error.message}`);
        return { success: false, message: "Une erreur est survenue lors de la récupération des réservations." };
    }
};

const getReservationParDate = async (date, userId) => {
    try {
        const query = `SELECT * FROM reservations WHERE date_reservation = ? AND id_utilisateur = ?`;
        const [rows] = await db.execute(query, [date, userId]);
        return rows.length > 0 ? { success: true, data: rows[0] } : { success: false, message: "Aucune réservation trouvée." };
    } catch (error) {
        winston.error(`Erreur lors de la récupération de la réservation pour la date ${date} : ${error.message}`);
        return { success: false, message: "Une erreur est survenue lors de la récupération de la réservation." };
    }
};
const getReservationExistante = async (date, heure, userId) => {
    try {
        const query = `
            SELECT id_reservation, id_terrain 
            FROM reservations 
            WHERE id_utilisateur = ? 
            AND date_reservation = ? 
            AND heure_debut = ?
            LIMIT 1
        `;
        const [rows] = await db.execute(query, [userId, date, heure]);
        if (rows.length > 0) {
            return { success: true, data: { id: rows[0].id_reservation, terrain_id: rows[0].id_terrain } };
        } else {
            return { success: false, message: "Aucune réservation trouvée pour cette date et heure." };
        }
    } catch (error) {
        winston.error(`Erreur lors de la vérification de la réservation pour ${userId} : ${error.message}`);
        return { success: false, message: "Une erreur est survenue lors de la vérification de la réservation." };
    }
};

const modifierReservation = async (date, ancienneHeure, nouvelleHeure, heureFin, userId) => {
    try {
        const query = `
            UPDATE reservations 
            SET heure_debut = ? , heure_fin = ?
            WHERE id_utilisateur = ? 
            AND date_reservation = ? 
            AND heure_debut = ?
        `;
        const [result] = await db.execute(query, [nouvelleHeure, heureFin, userId, date, ancienneHeure]);

        if (result.affectedRows > 0) {
            return { success: true, message: "La réservation a été modifiée avec succès." };
        } else {
            return { success: false, message: "La modification a échoué. Veuillez vérifier les informations." };
        }
    } catch (error) {
        winston.error(`Erreur lors de la modification de la réservation : ${error.message}`);
        return { success: false, message: "Une erreur est survenue lors de la modification de la réservation." };
    }
};

const getPlagesHorairesDisponibles = async (terrainNom, date) => {
    try {
        const idTerrain = await getTerrainIdByName(terrainNom);
        if (!idTerrain) return { success: false, message: "Terrain non trouvé." };

        const query = `
            SELECT heure_debut, heure_fin FROM reservations
            WHERE id_terrain = ? AND date_reservation = ?
            ORDER BY heure_debut ASC
        `;
        const [reservations] = await db.execute(query, [idTerrain, date]);

        let horairesDisponibles = [];
        let heureActuelle = moment("08:00", "HH:mm"); // Heure d'ouverture du terrain
        const heureFermeture = moment("23:00", "HH:mm"); // Heure de fermeture

        for (let res of reservations) {
            let debutRes = moment(res.heure_debut, "HH:mm");
            if (heureActuelle.isBefore(debutRes)) {
                horairesDisponibles.push(`${heureActuelle.format("HH:mm")} - ${debutRes.format("HH:mm")}`);
            }
            heureActuelle = moment(res.heure_fin, "HH:mm");
        }

        // Vérifier s'il reste du temps après la dernière réservation
        if (heureActuelle.isBefore(heureFermeture)) {
            horairesDisponibles.push(`${heureActuelle.format("HH:mm")} - ${heureFermeture.format("HH:mm")}`);
        }

        return { success: true, data: horairesDisponibles };
    } catch (error) {
        winston.error(`Erreur lors de la récupération des plages horaires pour ${terrainNom} le ${date}: ${error.message}`);
        return { success: false, message: "Une erreur est survenue lors de la récupération des plages horaires." };
    }
};



const testDisponibiliteDesTerrains = async (heureFin, terrainChoisi, date, time, res, req) => {
    try {
        // Vérification de la disponibilité du terrain
        const terrainDisponible = await verifierDisponibiliteTerrain(terrainChoisi, date, time, heureFin);

        if (!terrainDisponible) {
            // Si le terrain n'est pas dispo, proposer d'autres terrains
            const terrainsAlternatifs = await getTerrainsDisponibles(date, time, heureFin);

            if (terrainsAlternatifs.length > 0) {
                return res.json({
                    fulfillmentText: `Désolé, le terrain "${terrainChoisi}" est déjà réservé a "${date}" a "${time}". Voici d'autres terrains disponibles à la même heure : ${terrainsAlternatifs.join(", ")}. Lequel préférez-vous ?`,
                    outputContexts: [{
                        name: `${req.body.session}/contexts/date-heure-fournie`,
                        lifespanCount: 2,
                        parameters: {
                            "date": date,
                            "time": time
                        }
                    }]
                });
            } else {
                return res.json({
                    fulfillmentText: `Désolé, aucun terrain n'est disponible à cette date et heure. Voulez-vous choisir un autre créneau ?`,
                    outputContexts: [{
                        name: `${req.body.session}/contexts/reservation-demande`,
                        lifespanCount: 2
                    }]
                });
            }
        }

        return res.json({
            fulfillmentText: `Le terrain "${terrainChoisi}" est disponible a "${date}" a "${time}". Voulez-vous confirmer la réservation ?`,
            outputContexts: [{
                name: `${req.body.session}/contexts/choix-terrain`,
                lifespanCount: 2,
                parameters: {
                    "terrain": terrainChoisi,
                    "date": date,
                    "time": time
                }
            }]
        });
    } catch (error) {
        console.error("Erreur :", error);
        return res.json({
            fulfillmentText: "Une erreur s'est produite lors de la vérification de la disponibilité du terrain."
        });
    }
}
// Fonction pour ajouter 1 heure à une heure donnée (HH:MM)
/**
 * Ajoute 1 heure et 30 minutes à une heure donnée.
 * @param {string} heure - Heure au format HH:mm.
 * @returns {string} - Nouvelle heure au format HH:mm.
 */
const addOneHourAndHalf = (heure) => {
    let [h, m] = heure.split(':').map(Number);

    m += 30;
    if (m >= 60) {
        m -= 60;
        h += 1;
    }
    h = (h + 1) % 24; // Ajouter 1h et éviter dépassement de 23h

    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};



function extraireDateComplete(dateSansTime, dateTimeParam, timeParam, relativeDate, jourDate, dateExacte) {
    const now = moment().tz("Africa/Tunis"); // Date et heure actuelles
    let finalDate = null;

    // Gestion des dates exactes (ex: "le 10 mars")
    if (dateExacte) {
        const dateParts = dateExacte.replace(/^le\s*/, "").split(" ");
        if (dateParts[0].toLowerCase() === "1er") dateParts[0] = "1";

        const day = parseInt(dateParts[0], 10);
        const monthName = dateParts[1].toLowerCase();

        const months = {
            "janvier": 0, "février": 1, "mars": 2, "avril": 3, "mai": 4, "juin": 5,
            "juillet": 6, "août": 7, "septembre": 8, "octobre": 9, "novembre": 10, "décembre": 11
        };

        if (months[monthName] !== undefined) {
            finalDate = moment.tz({ year: now.year(), month: months[monthName], day }, "Africa/Tunis");
        } else {
            return { error: "Date exacte non reconnue. Reformulez SVP." };
        }
    }

    // Gestion des dates relatives
    if (relativeDate) {
        const relativeMapping = {
            "demain": 1,
            "après-demain": 2,
            "hier": -1,
            "aujourd'hui": 0
        };
        if (relativeMapping[relativeDate.toLowerCase()] !== undefined) {
            finalDate = now.clone().add(relativeMapping[relativeDate.toLowerCase()], "days").startOf("day");
        } else {
            return { error: "Date relative non reconnue. Reformulez SVP." };
        }
    }

    // Gestion des dates et heures exactes (format @sys.date-time)
    if (!finalDate && dateTimeParam) {
        finalDate = moment.tz(dateTimeParam.date_time || dateTimeParam, "Africa/Tunis");
        if (!finalDate.isValid()) return { error: "Date non valide. Reformulez SVP." };
    }
    // Traitement des différentes formes de date
    if (!finalDate && dateSansTime) {

        // Si le format est "DD/MM", on ajoute l'année actuelle
        if (/^\d{2}\/\d{2}$/.test(dateSansTime)) {
            dateSansTime += `/${now.year()}`; // Ajoute l'année actuelle
        }

        // Essayer différents formats, y compris avec ou sans barres obliques
        finalDate = moment(dateSansTime, ["DD/MM/YYYY", "DD-MM-YYYY", "YYYY-MM-DD"], true);

        // Vérification manuelle si le format avec "/" ne fonctionne pas
        if (!finalDate.isValid()) {
            finalDate = moment(dateSansTime, "DD/MM/YYYY"); // Retirer le mode strict
        }

        if (!finalDate.isValid()) return { error: "Format de date invalide. Reformulez SVP." };
    }

    // Gestion des jours de la semaine (ex: "Samedi à 14h")
    if (!finalDate && jourDate) {
        const jours = { "lundi": 1, "mardi": 2, "mercredi": 3, "jeudi": 4, "vendredi": 5, "samedi": 6, "dimanche": 0 };
        if (jours[jourDate.toLowerCase()] !== undefined) {
            let dayOffset = (jours[jourDate.toLowerCase()] - now.day() + 7) % 7;
            finalDate = now.clone().add(dayOffset, "days").startOf("day");
        } else {
            return { error: "Jour non reconnu. Reformulez SVP." };
        }
    }
    // Gestion de l'heure si fournie
    if (timeParam) {
        let extractedTime = moment(timeParam, moment.ISO_8601, true);
        if (!extractedTime.isValid()) {
            const normalizedTime = timeParam.replace(/h$/, "");
            const specialTimes = { "midi": 12, "minuit": 0, "matin": 9, "après-midi": 15, "soir": 19, "nuit": 23 };
            if (specialTimes[normalizedTime.toLowerCase()] !== undefined) {
                extractedTime = moment().hour(specialTimes[normalizedTime.toLowerCase()]).minute(0);
            } else {
                const timeParts = normalizedTime.split(/[:h]/).map(Number);
                extractedTime = moment().hour(timeParts[0] || 12).minute(timeParts[1] || 0);
            }
        }
        if (!finalDate) finalDate = now.clone().startOf("day");
        finalDate.hour(extractedTime.hour()).minute(extractedTime.minute());
    }
    // Vérification de la validité de finalDate
    if (!finalDate || !finalDate.isValid()) {
        return { error: "Je n'ai pas compris la date. Pouvez-vous reformuler ?" };
    }
    let formattedDate;
    if (!timeParam && !dateTimeParam) {
        formattedDate = finalDate.format("DD MMMM YYYY");

    } else if (!dateExacte && !jourDate && !relativeDate && !dateSansTime && !dateTimeParam) {
        formattedDate = finalDate.format("HH:mm");
    }
    else {// Formatage de la date finale
        formattedDate = finalDate.format("DD MMMM YYYY [à] HH:mm");
    }

    return { formattedDate, finalDate };
}
// Récupérer l'ID d'un terrain par son nom
const getTerrainIdByName = async (terrainNom) => {
    try {
        if (!terrainNom) {
            throw new Error("Le nom du terrain est requis.");
        }

        const query = `SELECT id_terrain FROM terrains WHERE nom = ?`;
        const [rows] = await db.execute(query, [terrainNom]);

        return rows.length > 0 ? rows[0].id_terrain : null;
    } catch (error) {
        logger.error(`Erreur getTerrainIdByName: ${error.message}`);
        throw error;
    }
};
// Récupérer le nom d'un terrain par son ID
const getTerrainNameById = async (terrainId) => {
    try {
        if (!terrainId) {
            throw new Error("L'ID du terrain est requis.");
        }

        const query = `SELECT nom FROM terrains WHERE id_terrain = ?`;
        const [rows] = await db.execute(query, [terrainId]);

        return rows.length > 0 ? rows[0].nom : null;
    } catch (error) {
        logger.error(`Erreur getTerrainNameById: ${error.message}`);
        throw error;
    }
};



// Vérifier la disponibilité d'un terrain
const verifierDisponibiliteTerrain = async (terrainNom, date, heureDebut, heureFin) => {
    try {
        if (!isValidDate(date) || !isValidTime(heureDebut) || !isValidTime(heureFin)) {
            throw new Error("Format de date ou d'heure invalide.");
        }

        const idTerrain = await getTerrainIdByName(terrainNom);
        if (!idTerrain) {
            throw new Error(`Terrain \"${terrainNom}\" non trouvé.`);
        }

        const query = `
            SELECT id_reservation FROM reservations
            WHERE id_terrain = ? AND date_reservation = ?
            AND (
                (heure_debut < ? AND heure_fin > ?) OR
                (heure_debut >= ? AND heure_debut < ?) OR
                (heure_fin > ? AND heure_fin <= ?)
            )
        `;

        const [result] = await db.execute(query, [idTerrain, date, heureFin, heureDebut, heureDebut, heureFin, heureDebut, heureFin]);

        return result.length === 0;
    } catch (error) {
        logger.error(`Erreur verifierDisponibiliteTerrain: ${error.message}`);
        throw error;
    }
};

// Récupérer les terrains disponibles
const getTerrainsDisponibles = async (date, heureDebut, heureFin) => {
    try {
        if (!isValidDate(date) || !isValidTime(heureDebut) || !isValidTime(heureFin)) {
            throw new Error("Format de date ou d'heure invalide.");
        }

        const query = `
            SELECT t.nom FROM terrains t
            WHERE t.id_terrain NOT IN (
                SELECT id_terrain FROM reservations
                WHERE date_reservation = ? 
                AND (
                    (heure_debut < ? AND heure_fin > ?) OR
                    (heure_debut >= ? AND heure_debut < ?) OR
                    (heure_fin > ? AND heure_fin <= ?)
                )
            )
        `;

        const [result] = await db.execute(query, [date, heureFin, heureDebut, heureDebut, heureFin, heureDebut, heureFin]);

        return result.map(row => row.nom);
    } catch (error) {
        logger.error(`Erreur getTerrainsDisponibles: ${error.message}`);
        throw error;
    }
};
module.exports = app;