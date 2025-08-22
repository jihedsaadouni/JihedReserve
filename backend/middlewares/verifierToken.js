const jwt = require("jsonwebtoken"); // Importation du module JSON Web Token
const db = require("../config/db"); // Connexion à la base de données
require("dotenv").config(); // Chargement des variables d'environnement

function verifierToken(req, res, next) {
    // 🔹 1️⃣ Récupérer le token envoyé dans l'en-tête de la requête (Authorization)
    const token = req.headers.authorization;

    // 🔹 2️⃣ Vérifier si le token est présent
    if (!token) {
        return res.status(401).json({ error: "Accès refusé : Token manquant" });
    }

    // 🔹 3️⃣ Vérifier le format du token (Il doit être sous la forme "Bearer <token>")
    const tokenParts = token.split(" ");
    if (tokenParts.length !== 2 || tokenParts[0] !== "Bearer") {
        return res.status(401).json({ error: "Format de token invalide" });
    }

    // 🔹 4️⃣ Extraire uniquement la valeur du token
    const accessToken = tokenParts[1];

    // 🔹 5️⃣ Vérifier la validité du token avec jwt.verify()
    jwt.verify(accessToken, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            // 🔸 Vérifier si l'erreur est due à un token expiré
            if (err.name === "TokenExpiredError") {
                return res.status(403).json({ error: "Token expiré, veuillez vous reconnecter" });
            }
            // 🔸 Sinon, c'est un token invalide (mauvaise signature, altéré, etc.)
            return res.status(403).json({ error: "Token invalide" });
        }

        // 🔹 6️⃣ Si le token est valide, on récupère les informations du user à partir de la base de données
        db.query("SELECT id_utilisateur, role FROM utilisateurs WHERE id_utilisateur = ?", [decoded.id_utilisateur], (err, results) => {
            if (err) {
                return res.status(500).json({ error: "Erreur serveur lors de la vérification de l'utilisateur" });
            }

            // 🔸 Vérifier si l'utilisateur existe en base
            if (results.length === 0) {
                return res.status(403).json({ error: "Utilisateur non trouvé" });
            }

            // 🔹 7️⃣ Ajouter les informations de l'utilisateur dans req.user pour les prochaines étapes
            req.user = {
                id_utilisateur: results[0].id_utilisateur,
                role: results[0].role
            };

            // 🔹 8️⃣ Passer à l'étape suivante (continuer vers la route demandée)
            next();
        });
    });
}

module.exports = verifierToken;
