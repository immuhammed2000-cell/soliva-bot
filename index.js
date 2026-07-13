const { Client, GatewayIntentBits } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

client.on('messageCreate', message => {
    if (message.author.bot) return;

    const content = message.content.trim();

    if (content.startsWith('!ضريبة') || content.startsWith('ضريبة')) {
        const args = content.split(/ +/);
        const amountStr = args[1];

        if (!amountStr || isNaN(amountStr)) return;

        const targetAmount = parseFloat(amountStr);
        if (targetAmount <= 0) return;

        const totalToSend = Math.ceil(targetAmount / 0.95);

        message.reply(`المبلغ المطلوب:\n**Amount to transfer: ${totalToSend}**`);
    }
});

client.login(token);
