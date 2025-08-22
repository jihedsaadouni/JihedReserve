import nodemailer from 'nodemailer';
import jwt from 'jsonwebtoken';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // Ton adresse Gmail
        pass: process.env.EMAIL_PASS, // Ton mot de passe d'application Gmail
    },
});

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

    const { userEmail, reservationId, stadeName, date, heure } = req.body;

    if (!userEmail || !reservationId) {
        return res.status(400).json({ message: 'Missing data' });
    }

    try {
        // 1. Créer un token de confirmation
        const token = jwt.sign(
            { reservationId },
            process.env.EMAIL_SECRET ,
            { expiresIn: '1h' }
        );

        // 2. Créer un lien de confirmation
        const confirmationLink = `${process.env.BASE_URL}/confirm-reservation?token=${token}`;

        // 3. Préparer le contenu de l'email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: userEmail,
            subject: 'Confirmation de votre réservation',
            html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>Votre réservation est presque confirmée !</h2>
        <p>Merci pour votre réservation du terrain <strong>${stadeName}</strong> pour le <strong>${date}</strong> à <strong>${heure}</strong>.</p>
        <p>Veuillez confirmer votre réservation en cliquant sur le bouton ci-dessous :</p>
        <a href="${confirmationLink}" style="
            display: inline-block;
            background-color: #1e90ff;
            color: white;
            padding: 10px 20px;
            text-decoration: none;
            border-radius: 5px;
            font-weight: bold;
        ">Confirmer ma réservation</a>
        <p>Ce lien expirera dans 1 heure.</p>
        </div> `,
        };

        // 4. Envoyer l’email
        await transporter.sendMail(mailOptions);

        return res.status(200).json({ message: 'Email envoyé avec succès' });
    } catch (error) {
        console.error('Erreur lors de l’envoi de l’email :', error);
        return res.status(500).json({ message: 'Erreur lors de l’envoi de l’email' });
    }
}
