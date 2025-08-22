const Joi = require('joi');

// Schéma pour valider un terrain lors de la création ou de la modification
const schemaCreationTerrain = Joi.object({
    nom: Joi.string().min(3).max(100).required(),
    localisation: Joi.string().min(3).max(100).required(),
    prix_par_science: Joi.number().positive().required(),
    description: Joi.string().allow(null, '').max(255)
});

// Schéma pour valider un ID (utilisé pour les opérations avec paramètres)
const schemaValidationId = Joi.object({
    id: Joi.number().integer().positive().required()
});
module.exports = {
    schemaCreationTerrain,
    schemaValidationId
};