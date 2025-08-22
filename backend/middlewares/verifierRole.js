function verifierRole(...rolesAutorises) {
    return (req, res, next) => {
        // Vérifier si l'utilisateur est authentifié
        if (!req.user) {
            return res.status(401).json({ error: "Accès refusé : utilisateur non authentifié" });
        }

        // Vérifier si le rôle de l'utilisateur est autorisé
        if (!rolesAutorises.includes(req.user.role)) {
            return res.status(403).json({ error: "Accès refusé : vous n'avez pas les permissions nécessaires" });
        }

        next(); // Passe à la suite
    };
}

module.exports = verifierRole;
