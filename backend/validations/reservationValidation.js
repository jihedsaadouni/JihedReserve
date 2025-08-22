// Importation de Joi pour la validation des données
const Joi = require('joi');
// Validation de l'ID reservation
const schemaValidationId = Joi.object({
    id: Joi.number().integer().positive().required()
});

// Définition du schéma de validation des réservations
const schemaCreationReservation = Joi.object({
    id_terrain: Joi.number().integer().positive().required(),
    date_reservation: Joi.date().required(), // Validation de la date
    heure_debut: Joi.string()
        .pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
        .required()
        .messages({
            'string.pattern.base': 'L\'heure de début doit être au format HH:mm (ex : 14:30).'
        })
});

// Définition du schéma de validation des réservations
const schemaModificationReservation = Joi.object({
    date_reservation: Joi.date().required(),
    heure_debut: Joi.string()
        .pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
        .required()
        .messages({
            'string.pattern.base': 'L\'heure de début doit être au format HH:mm (ex : 14:30).'
        }),
    heure_fin: Joi.string()
        .pattern(/^([0-1][0-9]|2[0-3]):[0-5][0-9]$/)
        .required()
        .messages({
            'string.pattern.base': 'L\'heure de fin doit être au format HH:mm (ex : 15:30).'
        })
}).custom((value, helpers) => {
    // Comparaison des heures au format HH:mm
    if (value.heure_debut >= value.heure_fin) {
        return helpers.message('L\'heure de fin doit être postérieure à l\'heure de début.');
    }
    return value;
});

module.exports = {
    schemaCreationReservation,
    schemaModificationReservation,
    schemaValidationId
};