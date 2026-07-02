const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, Collection, RoleSelectMenuBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const prefix = '!';
const warnings = {};
const xpData = {};
const xpHistory = []; // { userId, amount, timestamp } لكل نقاط XP يتم كسبها، تُستخدم لفلترة لوحة الصدارة بالوقت
const cooldowns = new Collection();

// ضع هنا ID الرتبة المسؤولة عن استلام التذاكر كقيمة افتراضية (اختياري، ممكن تتغير عبر لوحة الاختيار)
const TICKET_ROLE_ID = process.env.TICKET_ROLE_ID || null;
const ticketRoles = {}; // guildId -> [roleId, roleId, ...] يتم تحديدها من قائمة الاختيار
let warningIdCounter = 1; // رقم فريد لكل تحذير عبر كامل السيرفر، لا يتكرر أبداً

function getXP(userId) {
  if (!xpData[userId]) xpData[userId] = { xp: 0, level: 1 };
  return xpData[userId];
}

function addXP(userId, amount) {
  const data = getXP(userId);
  data.xp += amount;
  xpHistory.push({ userId, amount, timestamp: Date.now() });
  const needed = data.level * 100;
  if (data.xp >= needed) {
    data.xp -= needed;
    data.level++;
    return true;
  }
  return false;
}

function getLeaderboard(period) {
  const now = Date.now();
  const ranges = {
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  const cutoff = ranges[period] ? now - ranges[period] : 0;

  const totals = {};
  for (const entry of xpHistory) {
    if (entry.timestamp >= cutoff) {
      totals[entry.userId] = (totals[entry.userId] || 0) + entry.amount;
    }
  }
  return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10);
}

function hasPerm(member, perm) {
  return member.permissions.has(perm);
}

function errorEmbed(msg) {
  return new EmbedBuilder().setColor('#ff0000').setDescription(`❌ ${msg}`);
}

function successEmbed(msg) {
  return new EmbedBuilder().setColor('#00ff00').setDescription(`✅ ${msg}`);
}

// ---------- منطق إنشاء التذكرة (مستخدم من الأمر النصي وزر اللوحة) ----------
async function openTicket(guild, user) {
  const existing = guild.channels.cache.find(c => c.name === `تذكرة-${user.username}`.toLowerCase());
  if (existing) return { channel: null, existing };

  let category = guild.channels.cache.find(c => c.name === 'التذاكر' && c.type === ChannelType.GuildCategory);
  if (!category) category = await guild.channels.create({ name: 'التذاكر', type: ChannelType.GuildCategory });

  const roleIds = ticketRoles[guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const roleId of roleIds) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({
    name: `تذكرة-${user.username}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('✋ استلام').setStyle(ButtonStyle.Primary),
  );
  const roleMentions = roleIds.map(id => `<@&${id}>`).join(' ');
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('🎫 تذكرة جديدة')
    .setDescription(`مرحباً ${user}!\nاكتب شكواك أو استفسارك وسيرد عليك المسؤولون قريباً.${roleMentions ? `\n\nستتم مراجعتها من قبل ${roleMentions}` : ''}`)
    .setTimestamp();

  await ticketChannel.send({ content: `${user} ${roleMentions}`.trim(), embeds: [embed], components: [row] });
  return { channel: ticketChannel, existing: null };
}

client.on('guildMemberAdd', async member => {
  const channel = member.guild.systemChannel;
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('🎉 عضو جديد انضم!')
    .setDescription(`أهلاً وسهلاً ${member} في سيرفر **${member.guild.name}**!`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .addFields(
      { name: '👤 الاسم', value: member.user.tag, inline: true },
      { name: '🔢 العضو رقم', value: `${member.guild.memberCount}`, inline: true },
      { name: '📅 حساب منشأ', value: member.user.createdAt.toLocaleDateString('ar'), inline: true },
    )
    .setTimestamp();
  channel.send({ embeds: [embed] });
});

client.on('guildMemberRemove', async member => {
  const channel = member.guild.systemChannel;
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle('👋 عضو غادر السيرفر')
    .setDescription(`وداعاً **${member.user.tag}**`)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setTimestamp();
  channel.send({ embeds: [embed] });
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const cdKey = `xp-${message.author.id}`;
  if (!cooldowns.has(cdKey)) {
    const leveled = addXP(message.author.id, Math.floor(Math.random() * 10) + 5);
    cooldowns.set(cdKey, Date.now());
    setTimeout(() => cooldowns.delete(cdKey), 60000);
    if (leveled) {
      const data = getXP(message.author.id);
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 ترقية مستوى!')
        .setDescription(`تهانينا ${message.author}! وصلت للمستوى **${data.level}** 🚀`)
        .setTimestamp();
      message.channel.send({ embeds: [embed] });
    }
  }

  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (['مساعدة', 'help', 'اوامر'].includes(command)) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📋 أوامر Soliva Bot')
      .addFields(
        { name: '🛡️ الإدارة', value: '`!كيك` `!باند` `!رفع-باند` `!تحذير` `!تحذيرات` `!شيل-تحذير` `!مسح-تحذيرات` `!كتم` `!رفع-كتم` `!مسح`' },
        { name: '📊 المستويات', value: '`!T day` `!T week` `!T month` `!T year` `!Top` (من بداية السيرفر)' },
        { name: '🎫 التذاكر', value: '`!تذكرة` `!لوحة-تذاكر` (إدارة فقط)' },
        { name: '👤 معلومات', value: '`!معلوماتي` `!سيرفر` `!بوت` `!بينغ`' },
        { name: '🎮 ترفيه', value: '`!تقليب-عملة` `!عشوائي` `!اختر`' },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (['كيك', 'طرد'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    const reason = args.slice(1).join(' ') || 'بدون سبب';
    await target.kick(reason);
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ff6600').setTitle('👢 تم الطرد').addFields({ name: 'العضو', value: target.user.tag, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
  }

  if (['باند', 'حظر'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    const reason = args.slice(1).join(' ') || 'بدون سبب';
    await target.ban({ reason });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('🔨 تم الحظر').addFields({ name: 'العضو', value: target.user.tag, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
  }

  if (['رفع-باند'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const userId = args[0];
    if (!userId) return message.reply({ embeds: [errorEmbed('أدخل ID العضو!')] });
    try { await message.guild.members.unban(userId); return message.reply({ embeds: [successEmbed(`تم رفع الحظر عن ${userId}`)] }); }
    catch { return message.reply({ embeds: [errorEmbed('ما قدرت أرفع الحظر!')] }); }
  }

  if (['تحذير'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    const reason = args.slice(1).join(' ') || 'بدون سبب';
    if (!warnings[target.id]) warnings[target.id] = [];
    const warnId = warningIdCounter++;
    warnings[target.id].push({ id: warnId, reason, date: new Date().toLocaleDateString('ar'), mod: message.author.tag });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setTitle('⚠️ تحذير').addFields({ name: 'العضو', value: target.user.tag, inline: true }, { name: 'رقم التحذير', value: `#${warnId}`, inline: true }, { name: 'إجمالي', value: `${warnings[target.id].length}`, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
  }

  if (['تحذيرات'].includes(command)) {
    const target = message.mentions.members.first() || message.member;
    const w = warnings[target.id];
    if (!w || w.length === 0) return message.reply({ embeds: [successEmbed(`${target.user.tag} ما عنده تحذيرات`)] });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setTitle(`⚠️ تحذيرات ${target.user.tag}`).setDescription(w.map(x => `**#${x.id}** - ${x.reason} | ${x.date}`).join('\n')).setFooter({ text: 'لحذف تحذير استخدم !شيل-تحذير <رقم>' })] });
  }

  if (['شيل-تحذير', 'حذف-تحذير'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const warnId = parseInt(args[0]);
    if (!warnId) return message.reply({ embeds: [errorEmbed('اكتب رقم التحذير! مثال: !شيل-تحذير 7')] });
    let found = false;
    for (const userId in warnings) {
      const idx = warnings[userId].findIndex(w => w.id === warnId);
      if (idx !== -1) {
        warnings[userId].splice(idx, 1);
        found = true;
        break;
      }
    }
    if (!found) return message.reply({ embeds: [errorEmbed(`ما لقيت تحذير برقم #${warnId}`)] });
    return message.reply({ embeds: [successEmbed(`تم حذف التحذير رقم #${warnId}`)] });
  }

  if (['مسح-تحذيرات'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    warnings[target.id] = [];
    return message.reply({ embeds: [successEmbed(`تم مسح تحذيرات ${target.user.tag}`)] });
  }

  if (['كتم'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    const minutes = parseInt(args[1]) || 10;
    const reason = args.slice(2).join(' ') || 'بدون سبب';
    await target.timeout(minutes * 60 * 1000, reason);
    return message.reply({ embeds: [new EmbedBuilder().setColor('#888888').setTitle('🔇 تم الكتم').addFields({ name: 'العضو', value: target.user.tag, inline: true }, { name: 'المدة', value: `${minutes} دقيقة`, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
  }

  if (['رفع-كتم'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    await target.timeout(null);
    return message.reply({ embeds: [successEmbed(`تم رفع الكتم عن ${target.user.tag}`)] });
  }

  if (['مسح', 'clear'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageMessages)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply({ embeds: [errorEmbed('حدد عدد بين 1 و 100!')] });
    await message.channel.bulkDelete(amount + 1, true);
    const msg = await message.channel.send({ embeds: [successEmbed(`تم مسح ${amount} رسالة`)] });
    setTimeout(() => msg.delete(), 3000);
  }

  // ---------- توب حسب فترة زمنية: T day / T week / T month / T year ----------
  if (command === 't') {
    const periodMap = {
      day: { key: 'day', label: 'اليوم' },
      week: { key: 'week', label: 'هذا الأسبوع' },
      month: { key: 'month', label: 'هذا الشهر' },
      year: { key: 'year', label: 'هذه السنة' },
    };
    const chosen = periodMap[(args[0] || '').toLowerCase()];
    if (!chosen) return message.reply({ embeds: [errorEmbed('استخدم: !T day / !T week / !T month / !T year')] });
    const sorted = getLeaderboard(chosen.key);
    if (sorted.length === 0) return message.reply({ embeds: [errorEmbed(`ما في نشاط مسجّل خلال ${chosen.label}!`)] });
    const medals = ['🥇', '🥈', '🥉'];
    const desc = sorted.map(([id, xp], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> - **${xp}** XP`).join('\n');
    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle(`🏆 لوحة الصدارة - ${chosen.label}`).setDescription(desc).setTimestamp()] });
  }

  // ---------- Top: لوحة الصدارة الكلية بالمستويات من بداية السيرفر ----------
  if (command === 'top') {
    const sorted = Object.entries(xpData).sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp).slice(0, 10);
    if (sorted.length === 0) return message.reply({ embeds: [errorEmbed('ما في بيانات بعد!')] });
    const medals = ['🥇', '🥈', '🥉'];
    const desc = sorted.map(([id, d], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> - المستوى ${d.level} | XP: ${d.xp}`).join('\n');
    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Top - من بداية السيرفر').setDescription(desc).setTimestamp()] });
  }

  if (['معلوماتي', 'whois'].includes(command)) {
    const target = message.mentions.members.first() || message.member;
    const roles = target.roles.cache.filter(r => r.id !== message.guild.id).map(r => r.toString()).join(', ') || 'لا يوجد';
    return message.reply({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle(`👤 معلومات ${target.user.tag}`).setThumbnail(target.user.displayAvatarURL({ dynamic: true })).addFields({ name: 'الاسم', value: target.user.tag, inline: true }, { name: 'الـ ID', value: target.id, inline: true }, { name: 'أعلى رتبة', value: target.roles.highest.name, inline: true }, { name: 'تاريخ الانضمام', value: target.joinedAt.toLocaleDateString('ar'), inline: true }, { name: 'الرتب', value: roles }).setTimestamp()] });
  }

  if (['سيرفر', 'serverinfo'].includes(command)) {
    const guild = message.guild;
    return message.reply({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle(`🏠 معلومات ${guild.name}`).setThumbnail(guild.iconURL({ dynamic: true })).addFields({ name: '👑 المالك', value: `<@${guild.ownerId}>`, inline: true }, { name: '👥 الأعضاء', value: `${guild.memberCount}`, inline: true }, { name: '📅 الإنشاء', value: guild.createdAt.toLocaleDateString('ar'), inline: true }, { name: '💬 القنوات', value: `${guild.channels.cache.size}`, inline: true }).setTimestamp()] });
  }

  if (['بوت'].includes(command)) {
    return message.reply({ embeds: [new EmbedBuilder().setColor('#7289da').setTitle('🤖 Soliva Bot').addFields({ name: '🏓 البينغ', value: `${client.ws.ping}ms`, inline: true }, { name: '⏱️ التشغيل', value: `${Math.floor(process.uptime() / 60)} دقيقة`, inline: true }, { name: '🌐 السيرفرات', value: `${client.guilds.cache.size}`, inline: true }).setTimestamp()] });
  }

  if (['بينغ'].includes(command)) {
    return message.reply({ embeds: [new EmbedBuilder().setColor('#00ff00').setDescription(`🏓 البينغ: **${client.ws.ping}ms**`)] });
  }

  if (['تقليب-عملة'].includes(command)) {
    const result = Math.random() < 0.5 ? '👑 صورة' : '🔵 كتابة';
    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🪙 تقليب العملة').setDescription(`النتيجة: **${result}**`)] });
  }

  if (['عشوائي'].includes(command)) {
    const min = parseInt(args[0]) || 1, max = parseInt(args[1]) || 100;
    return message.reply({ embeds: [new EmbedBuilder().setColor('#7289da').setTitle('🎲 رقم عشوائي').setDescription(`النتيجة: **${Math.floor(Math.random() * (max - min + 1)) + min}**`)] });
  }

  if (['اختر'].includes(command)) {
    const choices = args.join(' ').split('،');
    if (choices.length < 2) return message.reply({ embeds: [errorEmbed('أضف خيارين مفصولة بـ ،')] });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#00ff99').setTitle('🤔 اخترت لك').setDescription(`**${choices[Math.floor(Math.random() * choices.length)].trim()}**`)] });
  }

  if (['تذكرة', 'شكوى'].includes(command)) {
    const { channel: ticketChannel, existing } = await openTicket(message.guild, message.author);
    if (existing) return message.reply({ embeds: [errorEmbed(`عندك تذكرة مفتوحة: ${existing}`)] });
    return message.reply({ embeds: [successEmbed(`تم فتح تذكرتك: ${ticketChannel}`)] });
  }

  // ---------- لوحة تذاكر: أول خطوة اختيار الرولات المسؤولة ----------
  if (['لوحة-تذاكر', 'ticket-panel'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const roleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId('select_ticket_roles')
        .setPlaceholder('اختر الرول أو الرولات المسؤولة عن استلام التذاكر')
        .setMinValues(1)
        .setMaxValues(5)
    );
    return message.reply({ content: '👇 حدد الرول(ات) اللي بتشوف وتستلم كل التذاكر:', components: [roleRow] });
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isRoleSelectMenu() && interaction.customId === 'select_ticket_roles') {
    const roleIds = interaction.values; // مصفوفة IDs للرولات المختارة
    ticketRoles[interaction.guild.id] = roleIds;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_ticket').setLabel('إنشاء تذكرة').setEmoji('🎫').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('الدعم الفني')
      .setDescription('اضغط بالأسفل لإنشاء تذكرة دعم جديدة 🎫')
      .setFooter({ text: 'Powered by Soliva Bot', iconURL: client.user.displayAvatarURL() });

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.update({ content: `✅ تم تحديد الرولات: ${roleIds.map(id => `<@&${id}>`).join(' ')}`, components: [] });
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === 'open_ticket') {
    const { channel: ticketChannel, existing } = await openTicket(interaction.guild, interaction.user);
    if (existing) return interaction.reply({ embeds: [errorEmbed(`عندك تذكرة مفتوحة: ${existing}`)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed(`تم فتح تذكرتك: ${ticketChannel}`)], ephemeral: true });
  }

  if (interaction.customId === 'close_ticket') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('🔒 سيتم إغلاق التذكرة خلال 5 ثواني...')] });
    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }

  if (interaction.customId === 'claim_ticket') {
    const roleIds = ticketRoles[interaction.guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);
    const isSupport = roleIds.length > 0
      ? roleIds.some(id => interaction.member.roles.cache.has(id))
      : interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers);
    if (!isSupport) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية استلام التذاكر!')], ephemeral: true });
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });

    const claimedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('call_owner').setLabel('👑 استدعاء المالك').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('call_support').setLabel('🆘 استدعاء الدعم الفني').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.edit({ components: [claimedRow] });
    await interaction.reply({ embeds: [successEmbed(`تم استلام التذكرة من قبل ${interaction.user}`)] });
  }

  if (interaction.customId === 'call_owner') {
    const owner = await interaction.guild.fetchOwner();
    await interaction.reply({ content: `🔔 ${owner}، تم استدعاؤك من قبل ${interaction.user} بهذي التذكرة!` });
  }

  if (interaction.customId === 'call_support') {
    const roleIds = ticketRoles[interaction.guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);
    const mentions = roleIds.length > 0 ? roleIds.map(id => `<@&${id}>`).join(' ') : 'فريق الدعم';
    await interaction.reply({ content: `🆘 ${mentions}، مطلوب مساعدة إضافية بهذي التذكرة من ${interaction.user}!` });
  }
});

client.once('ready', () => {
  console.log(`✅ Soliva Bot جاهز | ${client.user.tag}`);
  client.user.setActivity('!مساعدة | Soliva Bot', { type: 0 });
});

client.login(process.env.TOKEN);

