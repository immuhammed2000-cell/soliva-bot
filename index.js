const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, Collection, RoleSelectMenuBuilder,
  SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder,
  TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
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

const fs = require('fs');
// ⚠️ مهم: لازم تربط Railway Volume وتحط مسارها هنا عبر متغير DATA_PATH، وإلا البيانات بترجع تنمسح مع كل تحديث
const DATA_FILE = process.env.DATA_PATH || './data.json';

const prefix = '!';
const warnings = {};
const xpData = {};
const xpHistory = []; // { userId, amount, timestamp } لكل نقاط XP يتم كسبها، تُستخدم لفلترة لوحة الصدارة بالوقت
const cooldowns = new Collection();

// ضع هنا ID الرتبة المسؤولة عن استلام التذاكر كقيمة افتراضية (اختياري، ممكن تتغير عبر لوحة الاختيار)
const TICKET_ROLE_ID = process.env.TICKET_ROLE_ID || null;
const ticketRoles = {}; // guildId -> [roleId, roleId, ...] يتم تحديدها من قائمة الاختيار
let warningIdCounter = 1; // رقم فريد لكل تحذير عبر كامل السيرفر، لا يتكرر أبداً
const levelUpChannel = {}; // guildId -> channelId محدد لرسائل الترقية
const xpLocked = {}; // guildId -> true/false لقفل أو فتح كسب الـ XP
const activeGames = {}; // channelId -> لعبة نشطة حالياً بهذا الروم
const ticketCategories = {}; // guildId -> [{key, name, emoji, roleIds}] أقسام التذاكر اللي تضيفها الإدارة
const ticketChannelRoles = {}; // channelId -> roleIds المرتبطة بتذكرة معينة (حسب قسمها)
const pendingCategory = {}; // userId -> {name, emoji} حالة مؤقتة بين المودال واختيار الرتب
// ---------- بنوك الألعاب ----------
const mufradJamPairs = [
  ['كتاب', 'كتب'], ['قلم', 'أقلام'], ['باب', 'أبواب'], ['ولد', 'أولاد'], ['بنت', 'بنات'],
  ['بيت', 'بيوت'], ['رجل', 'رجال'], ['امرأة', 'نساء'], ['طالب', 'طلاب'], ['معلم', 'معلمون'],
  ['جبل', 'جبال'], ['بحر', 'بحار'], ['نهر', 'أنهار'], ['شجرة', 'أشجار'], ['زهرة', 'أزهار'],
  ['حصان', 'خيول'], ['قطة', 'قطط'], ['كلب', 'كلاب'], ['سيارة', 'سيارات'], ['مدينة', 'مدن'],
]; // كل عنصر: [مفرد, جمع]

const typingSentences = [
  'البرمجة متعة حقيقية', 'السرعة في الكتابة مهارة', 'ديسكورد منصة رائعة',
  'الوقت كالسيف إن لم تقطعه قطعك', 'النجاح يحتاج صبر وعمل', 'القراءة غذاء العقل',
  'التكنولوجيا تتطور كل يوم', 'العمل الجماعي يصنع الإنجاز', 'التعلم رحلة لا تنتهي',
  'الابتسامة تفتح كل الأبواب',
];

const emojiRiddles = [
  { emojis: '🦁👑', answer: 'الأسد الملك' },
  { emojis: '🕷️👨', answer: 'سبايدرمان' },
  { emojis: '🧊👸', answer: 'ملكة الثلج' },
  { emojis: '🏴‍☠️🚢', answer: 'قراصنة الكاريبي' },
  { emojis: '🦇👨', answer: 'باتمان' },
  { emojis: '🐟🔍', answer: 'البحث عن نيمو' },
  { emojis: '👦🪄⚡', answer: 'هاري بوتر' },
];

function normalize(str) {
  return str.trim().replace(/\s+/g, ' ');
}

function startGame(channelId, type, answer) {
  activeGames[channelId] = { type, answer, startedAt: Date.now() };
}

function endGame(channelId) {
  delete activeGames[channelId];
}

// ---------- نظام الحفظ الدائم: يحفظ كل البيانات بملف عشان ما تنمسح عند إعادة التشغيل ----------
function saveData() {
  try {
    const data = {
      warnings, xpData, xpHistory, warningIdCounter,
      ticketRoles, ticketCategories, ticketChannelRoles,
      levelUpChannel, xpLocked,
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('❌ فشل حفظ البيانات:', err);
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.assign(warnings, data.warnings || {});
    Object.assign(xpData, data.xpData || {});
    if (Array.isArray(data.xpHistory)) xpHistory.push(...data.xpHistory);
    warningIdCounter = data.warningIdCounter || 1;
    Object.assign(ticketRoles, data.ticketRoles || {});
    Object.assign(ticketCategories, data.ticketCategories || {});
    Object.assign(ticketChannelRoles, data.ticketChannelRoles || {});
    Object.assign(levelUpChannel, data.levelUpChannel || {});
    Object.assign(xpLocked, data.xpLocked || {});
    console.log('✅ تم تحميل البيانات المحفوظة بنجاح');
  } catch (err) {
    console.error('❌ فشل تحميل البيانات:', err);
  }
}

loadData();
setInterval(saveData, 15000); // حفظ تلقائي كل 15 ثانية
process.on('SIGTERM', () => { saveData(); process.exit(0); });
process.on('SIGINT', () => { saveData(); process.exit(0); });

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

function helpEmbed() {
  return new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle('📋 أوامر Soliva Bot')
    .setDescription('تقدر تستخدم الأوامر بثلاث طرق: `!أمر` أو `/أمر` أو حتى بدون علامة لأوامر T و Top فقط.')
    .addFields(
      { name: '🛡️ الإدارة', value: '`كيك` `باند` `رفع-باند` `تحذير` `تحذيرات` `شيل-تحذير` `مسح-تحذيرات` `كتم` `رفع-كتم` `مسح`' },
      { name: '⚙️ إعدادات', value: '`روم-الترقية #روم` `قفل-اكسبي` `فتح-اكسبي`' },
      { name: '📊 المستويات', value: '`T day` `T week` `T month` `T year` `Top` (من بداية السيرفر)' },
      { name: '🎫 التذاكر', value: '`تذكرة` `لوحة-تذاكر` `اعداد-التذاكر` (نظام أقسام متعددة، إدارة فقط)' },
      { name: '👤 معلومات', value: '`معلوماتي` `سيرفر` `بوت` `بينغ`' },
      { name: '🎮 ترفيه وألعاب', value: '`تقليب-عملة` `عشوائي` `اختر` `حجر <حجر/ورقة/مقص>` `تخمين` `مفرد` `جمع` `طباعة` `رياضيات` `ايموجي`' },
    )
    .setTimestamp();
}

// ---------- منطق إنشاء التذكرة (مستخدم من الأمر النصي وزر اللوحة وأمر السلاش) ----------
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

function ticketRolePrompt() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('select_ticket_roles')
      .setPlaceholder('اختر الرول أو الرولات المسؤولة عن استلام التذاكر')
      .setMinValues(1)
      .setMaxValues(5)
  );
}

// ---------- نظام أقسام التذاكر القابل للتخصيص (زي Ticket Tool) ----------
function ticketSetupEmbed(guildId) {
  const cats = ticketCategories[guildId] || [];
  const desc = cats.length
    ? cats.map(c => `${c.emoji} **${c.name}** — الرتب: ${c.roleIds.map(id => `<@&${id}>`).join(' ')}`).join('\n')
    : 'ما فيه أي قسم بعد. اضغط "➕ إضافة قسم" عشان تبدأ!';
  return new EmbedBuilder().setColor('#0099ff').setTitle('⚙️ إعداد نظام التذاكر').setDescription(desc)
    .setFooter({ text: 'ضيف الأقسام اللي تبيها، وبعدها اضغط نشر القائمة' });
}

function ticketSetupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_setup_add').setLabel('➕ إضافة قسم').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_setup_remove').setLabel('➖ حذف قسم').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_setup_publish').setLabel('📤 نشر القائمة').setStyle(ButtonStyle.Primary),
  );
}

async function openTicketCategory(guild, user, category) {
  const ticketName = `تذكرة-${category.name}-${user.username}`.toLowerCase().replace(/\s+/g, '-').slice(0, 90);
  const existing = guild.channels.cache.find(c => c.name === ticketName);
  if (existing) return { channel: null, existing };

  let cat = guild.channels.cache.find(c => c.name === 'التذاكر' && c.type === ChannelType.GuildCategory);
  if (!cat) cat = await guild.channels.create({ name: 'التذاكر', type: ChannelType.GuildCategory });

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const roleId of category.roleIds) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({ name: ticketName, type: ChannelType.GuildText, parent: cat.id, permissionOverwrites: overwrites });
  ticketChannelRoles[ticketChannel.id] = category.roleIds;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('✋ استلام').setStyle(ButtonStyle.Primary),
  );
  const roleMentions = category.roleIds.map(id => `<@&${id}>`).join(' ');
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${category.emoji} تذكرة: ${category.name}`)
    .setDescription(`مرحباً ${user}!\nاكتب استفسارك وسيرد عليك فريق **${category.name}** قريباً.${roleMentions ? `\n\nستتم مراجعتها من قبل ${roleMentions}` : ''}`)
    .setTimestamp();

  await ticketChannel.send({ content: `${user} ${roleMentions}`.trim(), embeds: [embed], components: [row] });
  return { channel: ticketChannel, existing: null };
}

function leaderboardByPeriod(periodKey, periodLabel) {
  const sorted = getLeaderboard(periodKey);
  if (sorted.length === 0) return errorEmbed(`ما في نشاط مسجّل خلال ${periodLabel}!`);
  const medals = ['🥇', '🥈', '🥉'];
  const desc = sorted.map(([id, xp], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> - **${xp}** XP`).join('\n');
  return new EmbedBuilder().setColor('#FFD700').setTitle(`🏆 لوحة الصدارة - ${periodLabel}`).setDescription(desc).setTimestamp();
}

function topAllTimeEmbed() {
  const sorted = Object.entries(xpData).sort((a, b) => b[1].level - a[1].level || b[1].xp - a[1].xp).slice(0, 10);
  if (sorted.length === 0) return errorEmbed('ما في بيانات بعد!');
  const medals = ['🥇', '🥈', '🥉'];
  const desc = sorted.map(([id, d], i) => `${medals[i] || `**${i + 1}.**`} <@${id}> - المستوى ${d.level} | XP: ${d.xp}`).join('\n');
  return new EmbedBuilder().setColor('#FFD700').setTitle('🏆 Top - من بداية السيرفر').setDescription(desc).setTimestamp();
}

const periodLabels = { day: 'اليوم', week: 'هذا الأسبوع', month: 'هذا الشهر', year: 'هذه السنة' };

// ================= تعريف أوامر السلاش (/) =================
const slashCommands = [
  new SlashCommandBuilder().setName('مساعدة').setDescription('عرض كل أوامر البوت'),
  new SlashCommandBuilder().setName('تذكرة').setDescription('فتح تذكرة دعم جديدة'),
  new SlashCommandBuilder().setName('لوحة-تذاكر').setDescription('إرسال لوحة فتح تذاكر بزر (إدارة فقط)'),
  new SlashCommandBuilder().setName('كيك').setDescription('طرد عضو من السيرفر')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('باند').setDescription('حظر عضو من السيرفر')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('رفع-باند').setDescription('رفع حظر عن عضو بواسطة الـ ID')
    .addStringOption(o => o.setName('id').setDescription('ID العضو').setRequired(true)),
  new SlashCommandBuilder().setName('تحذير').setDescription('إعطاء تحذير لعضو')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('تحذيرات').setDescription('عرض تحذيرات عضو')
    .addUserOption(o => o.setName('user').setDescription('العضو')),
  new SlashCommandBuilder().setName('شيل-تحذير').setDescription('حذف تحذير برقمه الفريد')
    .addIntegerOption(o => o.setName('id').setDescription('رقم التحذير').setRequired(true)),
  new SlashCommandBuilder().setName('مسح-تحذيرات').setDescription('مسح كل تحذيرات عضو')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder().setName('كتم').setDescription('كتم عضو مؤقتاً')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('عدد الدقائق'))
    .addStringOption(o => o.setName('reason').setDescription('السبب')),
  new SlashCommandBuilder().setName('رفع-كتم').setDescription('رفع الكتم عن عضو')
    .addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder().setName('مسح').setDescription('حذف عدد من الرسائل')
    .addIntegerOption(o => o.setName('amount').setDescription('عدد الرسائل (1-100)').setRequired(true)),
  new SlashCommandBuilder().setName('t').setDescription('لوحة الصدارة حسب فترة زمنية')
    .addStringOption(o => o.setName('period').setDescription('الفترة').setRequired(true)
      .addChoices(
        { name: 'يوم', value: 'day' },
        { name: 'اسبوع', value: 'week' },
        { name: 'شهر', value: 'month' },
        { name: 'سنة', value: 'year' },
      )),
  new SlashCommandBuilder().setName('top').setDescription('لوحة الصدارة الكلية من بداية السيرفر'),
  new SlashCommandBuilder().setName('معلوماتي').setDescription('عرض معلومات عضو')
    .addUserOption(o => o.setName('user').setDescription('العضو')),
  new SlashCommandBuilder().setName('سيرفر').setDescription('عرض معلومات السيرفر'),
  new SlashCommandBuilder().setName('بوت').setDescription('عرض معلومات البوت'),
  new SlashCommandBuilder().setName('بينغ').setDescription('عرض سرعة استجابة البوت'),
  new SlashCommandBuilder().setName('تقليب-عملة').setDescription('تقليب عملة'),
  new SlashCommandBuilder().setName('عشوائي').setDescription('توليد رقم عشوائي')
    .addIntegerOption(o => o.setName('min').setDescription('الحد الأدنى'))
    .addIntegerOption(o => o.setName('max').setDescription('الحد الأعلى')),
  new SlashCommandBuilder().setName('اختر').setDescription('يختار لك بين خيارات مفصولة بـ ،')
    .addStringOption(o => o.setName('options').setDescription('اكتب الخيارات مفصولة بـ ،').setRequired(true)),
];

async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  const body = slashCommands.map(cmd => cmd.toJSON());
  for (const guild of client.guilds.cache.values()) {
    try {
      await rest.put(Routes.applicationGuildCommands(client.user.id, guild.id), { body });
      console.log(`✅ تم تسجيل أوامر السلاش لسيرفر ${guild.name}`);
    } catch (err) {
      console.error(`❌ فشل تسجيل أوامر السلاش لسيرفر ${guild.id}`, err);
    }
  }
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
  if (!xpLocked[message.guild.id] && !cooldowns.has(cdKey)) {
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
      const targetChannelId = levelUpChannel[message.guild.id];
      const targetChannel = targetChannelId ? message.guild.channels.cache.get(targetChannelId) : message.guild.systemChannel;
      if (targetChannel) targetChannel.send({ embeds: [embed] });
    }
  }

  // ---------- تحقق من إجابات الألعاب النشطة بهذا الروم ----------
  const activeGame = activeGames[message.channel.id];
  if (activeGame) {
    const guess = normalize(message.content);
    if (activeGame.type === 'guess' && /^\d+$/.test(guess)) {
      const num = parseInt(guess);
      const target = parseInt(activeGame.answer);
      if (num === target) {
        endGame(message.channel.id);
        addXP(message.author.id, 15);
        return message.reply({ embeds: [successEmbed(`🎉 صح! الرقم كان **${target}** — ${message.author} فاز وأخذ 15 XP إضافية!`)] });
      }
      return message.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setDescription(num < target ? '📈 الرقم أعلى من كذا!' : '📉 الرقم أقل من كذا!')] });
    }
    if (['mufrad', 'jam', 'typing', 'math', 'emoji'].includes(activeGame.type) && guess === normalize(activeGame.answer)) {
      endGame(message.channel.id);
      addXP(message.author.id, 10);
      return message.reply({ embeds: [successEmbed(`🎉 صح! ${message.author} فاز وأخذ 10 XP إضافية!`)] });
    }
  }

  // ---------- تشغيل T/Top بدون أي علامة، بشرط تطابق تام للرسالة (تفادي التفعيل بالغلط أثناء الدردشة) ----------
  const rawContent = message.content.trim();
  const noPrefixMatch = rawContent.match(/^t\s+(day|week|month|year)$/i);
  if (noPrefixMatch) {
    const key = noPrefixMatch[1].toLowerCase();
    return message.reply({ embeds: [leaderboardByPeriod(key, periodLabels[key])] });
  }
  if (/^top$/i.test(rawContent)) {
    return message.reply({ embeds: [topAllTimeEmbed()] });
  }


  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (['مساعدة', 'help', 'اوامر'].includes(command)) {
    return message.reply({ embeds: [helpEmbed()] });
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

  // ---------- توب حسب فترة زمنية: !T day / !T week / !T month / !T year ----------
  if (command === 't') {
    const key = (args[0] || '').toLowerCase();
    if (!periodLabels[key]) return message.reply({ embeds: [errorEmbed('استخدم: !T day / !T week / !T month / !T year')] });
    return message.reply({ embeds: [leaderboardByPeriod(key, periodLabels[key])] });
  }

  // ---------- Top: لوحة الصدارة الكلية بالمستويات من بداية السيرفر ----------
  if (command === 'top') {
    return message.reply({ embeds: [topAllTimeEmbed()] });
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


  if (['روم-الترقية'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply({ embeds: [errorEmbed('منشن الروم! مثال: !روم-الترقية #ترقيات')] });
    levelUpChannel[message.guild.id] = channel.id;
    return message.reply({ embeds: [successEmbed(`تم تحديد روم الترقيات: ${channel}`)] });
  }

  if (['قفل-اكسبي', 'قفل-xp'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    xpLocked[message.guild.id] = true;
    return message.reply({ embeds: [successEmbed('🔒 تم قفل نظام الـ XP، الأعضاء ما بيكسبون نقاط الحين')] });
  }

  if (['فتح-اكسبي', 'فتح-xp'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    xpLocked[message.guild.id] = false;
    return message.reply({ embeds: [successEmbed('🔓 تم فتح نظام الـ XP، رجع الأعضاء يكسبون نقاط')] });
  }

  if (['اختر'].includes(command)) {
    const choices = args.join(' ').split('،');
    if (choices.length < 2) return message.reply({ embeds: [errorEmbed('أضف خيارين مفصولة بـ ،')] });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#00ff99').setTitle('🤔 اخترت لك').setDescription(`**${choices[Math.floor(Math.random() * choices.length)].trim()}**`)] });
  }

  if (['مفرد'].includes(command)) {
    if (activeGames[message.channel.id]) return message.reply({ embeds: [errorEmbed('فيه لعبة شغالة بهذا الروم! خلصوها الأول')] });
    const [singular, plural] = mufradJamPairs[Math.floor(Math.random() * mufradJamPairs.length)];
    startGame(message.channel.id, 'mufrad', singular);
    return message.channel.send({ embeds: [new EmbedBuilder().setColor('#00ffcc').setTitle('🔤 لعبة مفرد').setDescription(`وش مفرد كلمة: **${plural}**؟\nاكتب الإجابة بدون أي علامة!`)] });
  }

  if (['جمع'].includes(command)) {
    if (activeGames[message.channel.id]) return message.reply({ embeds: [errorEmbed('فيه لعبة شغالة بهذا الروم! خلصوها الأول')] });
    const [singular, plural] = mufradJamPairs[Math.floor(Math.random() * mufradJamPairs.length)];
    startGame(message.channel.id, 'jam', plural);
    return message.channel.send({ embeds: [new EmbedBuilder().setColor('#00ffcc').setTitle('🔤 لعبة جمع').setDescription(`وش جمع كلمة: **${singular}**؟\nاكتب الإجابة بدون أي علامة!`)] });
  }

  if (['طباعة', 'ريبلكا'].includes(command)) {
    if (activeGames[message.channel.id]) return message.reply({ embeds: [errorEmbed('فيه لعبة شغالة بهذا الروم! خلصوها الأول')] });
    const sentence = typingSentences[Math.floor(Math.random() * typingSentences.length)];
    startGame(message.channel.id, 'typing', sentence);
    return message.channel.send({ embeds: [new EmbedBuilder().setColor('#ff66cc').setTitle('⌨️ لعبة الطباعة').setDescription(`اكتب هذي الجملة بالظبط بأسرع وقت:\n\n**${sentence}**`)] });
  }

  if (['رياضيات'].includes(command)) {
    if (activeGames[message.channel.id]) return message.reply({ embeds: [errorEmbed('فيه لعبة شغالة بهذا الروم! خلصوها الأول')] });
    const a = Math.floor(Math.random() * 50) + 1, b = Math.floor(Math.random() * 50) + 1;
    const ops = ['+', '-', '×'];
    const op = ops[Math.floor(Math.random() * ops.length)];
    let answer;
    if (op === '+') answer = a + b;
    else if (op === '-') answer = a - b;
    else answer = a * b;
    startGame(message.channel.id, 'math', `${answer}`);
    return message.channel.send({ embeds: [new EmbedBuilder().setColor('#66aaff').setTitle('🧮 لعبة الرياضيات').setDescription(`كم حل: **${a} ${op} ${b}**؟`)] });
  }

  if (['ايموجي'].includes(command)) {
    if (activeGames[message.channel.id]) return message.reply({ embeds: [errorEmbed('فيه لعبة شغالة بهذا الروم! خلصوها الأول')] });
    const riddle = emojiRiddles[Math.floor(Math.random() * emojiRiddles.length)];
    startGame(message.channel.id, 'emoji', riddle.answer);
    return message.channel.send({ embeds: [new EmbedBuilder().setColor('#ffaa66').setTitle('🧩 لعبة الايموجي').setDescription(`خمن وش يقصد هذا الرمز:\n\n# ${riddle.emojis}`)] });
  }

  if (['حجر'].includes(command)) {
    const choices = ['حجر', 'ورقة', 'مقص'];
    const userChoice = args[0];
    if (!choices.includes(userChoice)) return message.reply({ embeds: [errorEmbed('اكتب: !حجر حجر / !حجر ورقة / !حجر مقص')] });
    const botChoice = choices[Math.floor(Math.random() * 3)];
    let result;
    if (userChoice === botChoice) result = 'تعادل 🤝';
    else if (
      (userChoice === 'حجر' && botChoice === 'مقص') ||
      (userChoice === 'ورقة' && botChoice === 'حجر') ||
      (userChoice === 'مقص' && botChoice === 'ورقة')
    ) result = 'فزت! 🎉';
    else result = 'خسرت! 😢';
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ffcc00').setTitle('✂️ حجر ورقة مقص').addFields({ name: 'اختيارك', value: userChoice, inline: true }, { name: 'اختيار البوت', value: botChoice, inline: true }, { name: 'النتيجة', value: result })] });
  }

  if (['تخمين'].includes(command)) {
    if (activeGames[message.channel.id]) return message.reply({ embeds: [errorEmbed('فيه لعبة شغالة بهذا الروم! خلصوها الأول')] });
    const target = Math.floor(Math.random() * 100) + 1;
    startGame(message.channel.id, 'guess', `${target}`);
    return message.channel.send({ embeds: [new EmbedBuilder().setColor('#33ffaa').setTitle('🔢 لعبة تخمين الرقم').setDescription('فكرت برقم بين **1 و 100**! اكتب تخمينك بدون علامة، وبعطيك تلميح (أعلى/أقل)')] });
  }

  if (['تذكرة', 'شكوى'].includes(command)) {
    const { channel: ticketChannel, existing } = await openTicket(message.guild, message.author);
    if (existing) return message.reply({ embeds: [errorEmbed(`عندك تذكرة مفتوحة: ${existing}`)] });
    return message.reply({ embeds: [successEmbed(`تم فتح تذكرتك: ${ticketChannel}`)] });
  }

  // ---------- لوحة إعداد التذاكر التفاعلية (زي Ticket Tool) ----------
  if (['اعداد-التذاكر', 'ticket-setup'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    return message.reply({ embeds: [ticketSetupEmbed(message.guild.id)], components: [ticketSetupRow()] });
  }

  // ---------- لوحة تذاكر: أول خطوة اختيار الرولات المسؤولة ----------
  if (['لوحة-تذاكر', 'ticket-panel'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    return message.reply({ content: '👇 حدد الرول(ات) اللي بتشوف وتستلم كل التذاكر:', components: [ticketRolePrompt()] });
  }
});

client.on('interactionCreate', async interaction => {
  // ================= لوحة إعداد التذاكر: إضافة قسم =================
  if (interaction.isButton() && interaction.customId === 'ticket_setup_add') {
    const modal = new ModalBuilder().setCustomId('ticket_category_modal').setTitle('إضافة قسم تذكرة جديد');
    const nameInput = new TextInputBuilder().setCustomId('cat_name').setLabel('اسم القسم (مثال: دعم فني)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
    const emojiInput = new TextInputBuilder().setCustomId('cat_emoji').setLabel('ايموجي القسم (اختياري)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10);
    modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(emojiInput));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket_category_modal') {
    const name = interaction.fields.getTextInputValue('cat_name');
    const emoji = interaction.fields.getTextInputValue('cat_emoji') || '🎫';
    pendingCategory[interaction.user.id] = { name, emoji };
    return interaction.reply({ content: `👇 حدد الرتب المسؤولة عن قسم **${name}**:`, components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('ticket_category_roles').setPlaceholder('اختر رتبة أو أكثر').setMinValues(1).setMaxValues(5)
      )
    ], ephemeral: true });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'ticket_category_roles') {
    const pending = pendingCategory[interaction.user.id];
    if (!pending) return interaction.update({ content: '⚠️ صار خطأ، حاول تضيف القسم من جديد.', components: [] });
    const category = { key: `cat_${Date.now()}`, name: pending.name, emoji: pending.emoji, roleIds: interaction.values };
    if (!ticketCategories[interaction.guild.id]) ticketCategories[interaction.guild.id] = [];
    ticketCategories[interaction.guild.id].push(category);
    delete pendingCategory[interaction.user.id];
    return interaction.update({ content: `✅ تمت إضافة قسم **${category.emoji} ${category.name}** بنجاح!`, components: [] });
  }

  // ================= لوحة إعداد التذاكر: حذف قسم =================
  if (interaction.isButton() && interaction.customId === 'ticket_setup_remove') {
    const cats = ticketCategories[interaction.guild.id] || [];
    if (cats.length === 0) return interaction.reply({ embeds: [errorEmbed('ما فيه أقسام تحذفها!')], ephemeral: true });
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_setup_remove_select').setPlaceholder('اختر القسم اللي تبي تحذفه')
      .addOptions(cats.map(c => new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.key).setEmoji(c.emoji)));
    return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], ephemeral: true });
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_setup_remove_select') {
    const key = interaction.values[0];
    ticketCategories[interaction.guild.id] = (ticketCategories[interaction.guild.id] || []).filter(c => c.key !== key);
    return interaction.update({ content: '🗑️ تم حذف القسم بنجاح.', components: [] });
  }

  // ================= لوحة إعداد التذاكر: نشر القائمة =================
  if (interaction.isButton() && interaction.customId === 'ticket_setup_publish') {
    const cats = ticketCategories[interaction.guild.id] || [];
    if (cats.length === 0) return interaction.reply({ embeds: [errorEmbed('ضيف قسم واحد على الأقل قبل النشر!')], ephemeral: true });
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_open_select').setPlaceholder('اختر نوع التذكرة')
      .addOptions(cats.map(c => new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.key).setEmoji(c.emoji)));
    const embed = new EmbedBuilder().setColor('#FFD700').setTitle('الدعم الفني').setDescription('اختر نوع التذكرة اللي تبيها من القائمة تحت 👇')
      .setFooter({ text: 'Powered by Soliva Bot', iconURL: client.user.displayAvatarURL() });
    await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    return interaction.reply({ embeds: [successEmbed('تم نشر قائمة التذاكر بالروم! ✅')], ephemeral: true });
  }

  // ================= فتح تذكرة من قائمة الأقسام =================
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_open_select') {
    const key = interaction.values[0];
    const category = (ticketCategories[interaction.guild.id] || []).find(c => c.key === key);
    if (!category) return interaction.reply({ embeds: [errorEmbed('هذا القسم ما عاد موجود!')], ephemeral: true });
    const { channel: ticketChannel, existing } = await openTicketCategory(interaction.guild, interaction.user, category);
    if (existing) return interaction.reply({ embeds: [errorEmbed(`عندك تذكرة مفتوحة: ${existing}`)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed(`تم فتح تذكرتك: ${ticketChannel}`)], ephemeral: true });
  }

  // ================= أوامر السلاش (/) =================
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    if (cmd === 'مساعدة') return interaction.reply({ embeds: [helpEmbed()] });

    if (cmd === 'تذكرة') {
      const { channel: ticketChannel, existing } = await openTicket(interaction.guild, interaction.user);
      if (existing) return interaction.reply({ embeds: [errorEmbed(`عندك تذكرة مفتوحة: ${existing}`)], ephemeral: true });
      return interaction.reply({ embeds: [successEmbed(`تم فتح تذكرتك: ${ticketChannel}`)], ephemeral: true });
    }

    if (cmd === 'لوحة-تذاكر') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ManageGuild)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      return interaction.reply({ content: '👇 حدد الرول(ات) اللي بتشوف وتستلم كل التذاكر:', components: [ticketRolePrompt()] });
    }

    if (cmd === 'كيك') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.KickMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const target = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
      const reason = interaction.options.getString('reason') || 'بدون سبب';
      await target.kick(reason);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ff6600').setTitle('👢 تم الطرد').addFields({ name: 'العضو', value: target.user.tag, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
    }

    if (cmd === 'باند') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.BanMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'بدون سبب';
      await interaction.guild.members.ban(targetUser.id, { reason });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('🔨 تم الحظر').addFields({ name: 'العضو', value: targetUser.tag, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
    }

    if (cmd === 'رفع-باند') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.BanMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const userId = interaction.options.getString('id');
      try { await interaction.guild.members.unban(userId); return interaction.reply({ embeds: [successEmbed(`تم رفع الحظر عن ${userId}`)] }); }
      catch { return interaction.reply({ embeds: [errorEmbed('ما قدرت أرفع الحظر!')], ephemeral: true }); }
    }

    if (cmd === 'تحذير') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'بدون سبب';
      if (!warnings[targetUser.id]) warnings[targetUser.id] = [];
      const warnId = warningIdCounter++;
      warnings[targetUser.id].push({ id: warnId, reason, date: new Date().toLocaleDateString('ar'), mod: interaction.user.tag });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setTitle('⚠️ تحذير').addFields({ name: 'العضو', value: targetUser.tag, inline: true }, { name: 'رقم التحذير', value: `#${warnId}`, inline: true }, { name: 'إجمالي', value: `${warnings[targetUser.id].length}`, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
    }

    if (cmd === 'تحذيرات') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const w = warnings[targetUser.id];
      if (!w || w.length === 0) return interaction.reply({ embeds: [successEmbed(`${targetUser.tag} ما عنده تحذيرات`)] });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setTitle(`⚠️ تحذيرات ${targetUser.tag}`).setDescription(w.map(x => `**#${x.id}** - ${x.reason} | ${x.date}`).join('\n')).setFooter({ text: 'لحذف تحذير استخدم /شيل-تحذير' })] });
    }

    if (cmd === 'شيل-تحذير') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const warnId = interaction.options.getInteger('id');
      let found = false;
      for (const userId in warnings) {
        const idx = warnings[userId].findIndex(w => w.id === warnId);
        if (idx !== -1) { warnings[userId].splice(idx, 1); found = true; break; }
      }
      if (!found) return interaction.reply({ embeds: [errorEmbed(`ما لقيت تحذير برقم #${warnId}`)], ephemeral: true });
      return interaction.reply({ embeds: [successEmbed(`تم حذف التحذير رقم #${warnId}`)] });
    }

    if (cmd === 'مسح-تحذيرات') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const targetUser = interaction.options.getUser('user');
      warnings[targetUser.id] = [];
      return interaction.reply({ embeds: [successEmbed(`تم مسح تحذيرات ${targetUser.tag}`)] });
    }

    if (cmd === 'كتم') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const target = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
      const minutes = interaction.options.getInteger('minutes') || 10;
      const reason = interaction.options.getString('reason') || 'بدون سبب';
      await target.timeout(minutes * 60 * 1000, reason);
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#888888').setTitle('🔇 تم الكتم').addFields({ name: 'العضو', value: target.user.tag, inline: true }, { name: 'المدة', value: `${minutes} دقيقة`, inline: true }, { name: 'السبب', value: reason }).setTimestamp()] });
    }

    if (cmd === 'رفع-كتم') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ModerateMembers)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const target = await interaction.guild.members.fetch(interaction.options.getUser('user').id);
      await target.timeout(null);
      return interaction.reply({ embeds: [successEmbed(`تم رفع الكتم عن ${target.user.tag}`)] });
    }

    if (cmd === 'مسح') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ManageMessages)) return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
      const amount = interaction.options.getInteger('amount');
      if (!amount || amount < 1 || amount > 100) return interaction.reply({ embeds: [errorEmbed('حدد عدد بين 1 و 100!')], ephemeral: true });
      await interaction.channel.bulkDelete(amount, true);
      return interaction.reply({ embeds: [successEmbed(`تم مسح ${amount} رسالة`)] });
    }

    if (cmd === 't') {
      const key = interaction.options.getString('period');
      return interaction.reply({ embeds: [leaderboardByPeriod(key, periodLabels[key])] });
    }

    if (cmd === 'top') return interaction.reply({ embeds: [topAllTimeEmbed()] });

    if (cmd === 'معلوماتي') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const target = await interaction.guild.members.fetch(targetUser.id);
      const roles = target.roles.cache.filter(r => r.id !== interaction.guild.id).map(r => r.toString()).join(', ') || 'لا يوجد';
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle(`👤 معلومات ${target.user.tag}`).setThumbnail(target.user.displayAvatarURL({ dynamic: true })).addFields({ name: 'الاسم', value: target.user.tag, inline: true }, { name: 'الـ ID', value: target.id, inline: true }, { name: 'أعلى رتبة', value: target.roles.highest.name, inline: true }, { name: 'تاريخ الانضمام', value: target.joinedAt.toLocaleDateString('ar'), inline: true }, { name: 'الرتب', value: roles }).setTimestamp()] });
    }

    if (cmd === 'سيرفر') {
      const guild = interaction.guild;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle(`🏠 معلومات ${guild.name}`).setThumbnail(guild.iconURL({ dynamic: true })).addFields({ name: '👑 المالك', value: `<@${guild.ownerId}>`, inline: true }, { name: '👥 الأعضاء', value: `${guild.memberCount}`, inline: true }, { name: '📅 الإنشاء', value: guild.createdAt.toLocaleDateString('ar'), inline: true }, { name: '💬 القنوات', value: `${guild.channels.cache.size}`, inline: true }).setTimestamp()] });
    }

    if (cmd === 'بوت') {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#7289da').setTitle('🤖 Soliva Bot').addFields({ name: '🏓 البينغ', value: `${client.ws.ping}ms`, inline: true }, { name: '⏱️ التشغيل', value: `${Math.floor(process.uptime() / 60)} دقيقة`, inline: true }, { name: '🌐 السيرفرات', value: `${client.guilds.cache.size}`, inline: true }).setTimestamp()] });
    }

    if (cmd === 'بينغ') {
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#00ff00').setDescription(`🏓 البينغ: **${client.ws.ping}ms**`)] });
    }

    if (cmd === 'تقليب-عملة') {
      const result = Math.random() < 0.5 ? '👑 صورة' : '🔵 كتابة';
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🪙 تقليب العملة').setDescription(`النتيجة: **${result}**`)] });
    }

    if (cmd === 'عشوائي') {
      const min = interaction.options.getInteger('min') || 1;
      const max = interaction.options.getInteger('max') || 100;
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#7289da').setTitle('🎲 رقم عشوائي').setDescription(`النتيجة: **${Math.floor(Math.random() * (max - min + 1)) + min}**`)] });
    }

    if (cmd === 'اختر') {
      const choices = interaction.options.getString('options').split('،');
      if (choices.length < 2) return interaction.reply({ embeds: [errorEmbed('أضف خيارين مفصولة بـ ،')], ephemeral: true });
      return interaction.reply({ embeds: [new EmbedBuilder().setColor('#00ff99').setTitle('🤔 اخترت لك').setDescription(`**${choices[Math.floor(Math.random() * choices.length)].trim()}**`)] });
    }

    return;
  }

  // ================= قائمة اختيار رولات التذاكر =================
  if (interaction.isRoleSelectMenu() && interaction.customId === 'select_ticket_roles') {
    const roleIds = interaction.values;
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
    const roleIds = ticketChannelRoles[interaction.channel.id] || ticketRoles[interaction.guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);
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
    const roleIds = ticketChannelRoles[interaction.channel.id] || ticketRoles[interaction.guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);
    const mentions = roleIds.length > 0 ? roleIds.map(id => `<@&${id}>`).join(' ') : 'فريق الدعم';
    await interaction.reply({ content: `🆘 ${mentions}، مطلوب مساعدة إضافية بهذي التذكرة من ${interaction.user}!` });
  }
});

client.once('ready', async () => {
  console.log(`✅ Soliva Bot جاهز | ${client.user.tag}`);
  client.user.setActivity('!مساعدة | Soliva Bot', { type: 0 });
  await registerSlashCommands();
});

client.login(process.env.TOKEN);
