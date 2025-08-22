// utils/validation.js

// Vérifie si une date est valide (format YYYY-MM-DD)
const isValidDate = (date) => {
    return /^\d{4}-\d{2}-\d{2}$/.test(date);
};

// Vérifie si une heure est valide (format HH:MM)
const isValidTime = (time) => {
    return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
};

module.exports = { isValidDate, isValidTime };
