const express = require('express');
const router = express.Router();
const dialogflow = require('@google-cloud/dialogflow'); // Utiliser la bibliothèque officielle Dialogflow V2
const axios = require('axios'); // Utiliser axios pour envoyer la requête au webhook
require('dotenv').config();

// Configuration du client Dialogflow
const sessionClient = new dialogflow.SessionsClient({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
});

// Route POST pour gérer les messages du chatbot en Dialogflow V2
router.post("/message", async (req, res, next) => {
    try {
        const { message, sessionId } = req.body;
        const utilisateurId = req.query.userId;  // Récupérer l'ID utilisateur depuis les paramètres de l'URL

        if (!message) {
            return res.status(400).json({ error: "Le message est requis." });
        }

        if (!utilisateurId) {
            return res.status(400).json({ error: "L'ID utilisateur est requis." });
        }


        console.log("ID Utilisateur reçu : ", utilisateurId);  // Log de l'ID utilisateur
        console.log("Message reçu : ", message);
        await sendUserIdToWebhook(utilisateurId);  // Fonction qui envoie l'ID au webhook
        const sessionPath = sessionClient.projectAgentSessionPath(process.env.GOOGLE_PROJECT_ID, sessionId);
        const request = {
            session: sessionPath,
            queryInput: {
                text: {
                    text: message,
                    languageCode: 'fr'
                }
            },
            queryParams: {
                enableSpellingCorrection: true
            }
        };
        const responses = await sessionClient.detectIntent(request);
        const result = responses[0].queryResult;

        console.log("Réponse de Dialogflow:", result.fulfillmentText);

        if (result.diagnosticInfo?.spellingCorrection?.correctedText) {
            console.log("📝 Texte corrigé :", result.diagnosticInfo.spellingCorrection.correctedText);
        }
        // Log des réponses pour débogage
        const reply = result.fulfillmentText || "Désolé, je n'ai pas compris votre demande.";
        res.status(200).json({ reply });
    } catch (error) {
        console.error("Erreur lors de la communication avec Dialogflow:", error.message);
        next(error);
    }
});

// Fonction qui envoie l'ID utilisateur au Webhook
async function sendUserIdToWebhook(userId) {
    try {
        // Envoi de l'ID utilisateur au Webhook via POST
        await axios.post('http://localhost:3000/api/webhook/idUtilisateur', { userId: userId });
        console.log("ID utilisateur envoyé au Webhook avec succès.");
    } catch (error) {
        console.error("Erreur lors de l'envoi de l'ID utilisateur au Webhook :", error.message);
    }
}

module.exports = router;
