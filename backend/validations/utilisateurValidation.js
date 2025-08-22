const Joi = require('joi'); // Importer Joi

// ---------------------------- Schémas de validation ----------------------------

// Validation de l'ID utilisateur
const schemaValidationId = Joi.object({
    id: Joi.number().integer().positive().required()
});

// Validation de la création ou mise à jour d'un utilisateur
const schemaCreationUtilisateur = Joi.object({
    nom: Joi.string().min(3).max(50).required(),
    email: Joi.string().email().required(),
    telephone: Joi.string().pattern(/^[0-9]{8}$/).required(), // Exemple : 8 chiffres pour un numéro tunisien
    mot_de_passe: Joi.string().min(6).max(50).optional()
});

// Validation de la modification du rôle
const schemaModificationRole = Joi.object({
    role: Joi.string().valid("admin", "utilisateur", "gerant").required()
});

module.exports = {
    schemaCreationUtilisateur,
    schemaModificationRole,
    schemaValidationId
};