// middlewares/errorHandler.js

/**
 * Middleware global de gestion des erreurs
 * Cette fonction capture toutes les erreurs qui se produisent dans les routes
 * et renvoie une réponse standardisée au client.
 *
 * @param {Error} err - L'erreur qui s'est produite.
 * @param {Request} req - L'objet requête.
 * @param {Response} res - L'objet réponse.
 * @param {Function} next - La fonction next pour passer au middleware suivant (non utilisée ici).
 */
module.exports = (err, req, res, next) => {
    // Affiche la pile d'erreur dans la console pour le debugging.
    console.error("Stack de l'erreur:", err.stack);

    // Vérifie si l'erreur a déjà un code de statut (par exemple, défini dans une route) sinon on met 500 par défaut.
    const statusCode = err.statusCode || 500;

    // Envoi d'une réponse JSON standardisée au client
    res.status(statusCode).json({
        message: "Erreur serveur. Veuillez réessayer plus tard.",
        // En développement, on peut renvoyer plus de détails (à ne pas faire en production)
        error: process.env.NODE_ENV === "development" ? err.message : undefined
    });
};
