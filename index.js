const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, RoleSelectMenuBuilder,
  SlashCommandBuilder, REST, Routes, ModalBuilder, TextInputBuilder,
  TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const fs = require('fs');
// ⚠️ مهم: يجب ربط Railway Volume وتحديد مساره هنا عبر متغير DATA_PATH، وإلا فإن بيانات التذاكر ستُفقد مع كل تحديث.
const DATA_FILE = process.env.DATA_PATH || './data.json';

const prefix = '!';
const BOT_NAME = '𝐑𝟕 ⌇ 𝐒𝐇𝐎𝐏';
const TAX_RATE = 0.05; // نسبة الضريبة: 5%

// ضع هنا معرّف الرتبة المسؤولة عن استلام التذاكر كقيمة افتراضية (اختياري، يمكن تغييره لاحقًا عبر لوحة الاختيار)
const TICKET_ROLE_ID = process.env.TICKET_ROLE_ID || null;
const ticketRoles = {}; // guildId -> [roleId, ...] (نظام التذاكر البسيط ذو الرتبة الواحدة)
const ticketCategories = {}; // guildId -> [{key, name, emoji, roleIds}] أقسام التذاكر القابلة للتخصيص
const ticketChannelRoles = {}; // channelId -> roleIds المرتبطة بتذكرة معينة حسب قسمها
const pendingCategory = {}; // userId -> {name, emoji} حالة مؤقتة بين نافذة الإدخال واختيار الرتب
const ticketLogChannel = {}; // guildId -> channelId المخصص لسجل التذاكر
const ticketInfo = {}; // channelId -> {openerId, categoryName, openedAt, number} لتفاصيل التذكرة
const ticketCounter = {}; // guildId -> آخر رقم تذكرة تم استخدامه

function saveData() {
  try {
    const data = { ticketRoles, ticketCategories, ticketChannelRoles, ticketLogChannel, ticketCounter };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
  } catch (err) {
    console.error('❌ حدث خطأ أثناء حفظ البيانات:', err);
  }
}

function loadData() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    Object.assign(ticketRoles, data.ticketRoles || {});
    Object.assign(ticketCategories, data.ticketCategories || {});
    Object.assign(ticketChannelRoles, data.ticketChannelRoles || {});
    Object.assign(ticketLogChannel, data.ticketLogChannel || {});
    Object.assign(ticketCounter, data.ticketCounter || {});
    console.log('✅ تم تحميل بيانات التذاكر المحفوظة بنجاح');
  } catch (err) {
    console.error('❌ حدث خطأ أثناء تحميل البيانات:', err);
  }
}

loadData();
setInterval(saveData, 15000);
process.on('SIGTERM', () => { saveData(); process.exit(0); });
process.on('SIGINT', () => { saveData(); process.exit(0); });

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
    .setTitle(`📋 أوامر ${BOT_NAME}`)
    .setDescription('يمكن استخدام الأوامر عبر `!أمر` أو `/أمر`.')
    .addFields(
      { name: '🎫 التذاكر', value: '`تذكرة` `لوحة-تذاكر` `اعداد-التذاكر` `روم-سجل-التذاكر #روم` `اضافة @شخص` `ازالة @شخص`' },
      { name: '💰 الضريبة', value: '`ضريبة [المبلغ]` — يحسب المبلغ الذي يجب إرساله ليصل المبلغ المطلوب بعد خصم 5% ضريبة' },
    )
    .setTimestamp();
}

function findOpenTicket(guild, userId) {
  for (const [channelId, info] of Object.entries(ticketInfo)) {
    if (info.openerId === userId && guild.channels.cache.has(channelId)) {
      return guild.channels.cache.get(channelId);
    }
  }
  return null;
}

function nextTicketNumber(guildId) {
  ticketCounter[guildId] = (ticketCounter[guildId] || 0) + 1;
  return String(ticketCounter[guildId]).padStart(4, '0');
}

// ================= نظام التذاكر البسيط (رتبة واحدة أو أكثر لكل السيرفر) =================
async function openTicket(guild, user) {
  const existing = findOpenTicket(guild, user.id);
  if (existing) return { channel: null, existing };

  let category = guild.channels.cache.find(c => c.name === 'التذاكر' && c.type === ChannelType.GuildCategory);
  if (!category) category = await guild.channels.create({ name: 'التذاكر', type: ChannelType.GuildCategory });

  const roleIds = ticketRoles[guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);
  const number = nextTicketNumber(guild.id);

  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const roleId of roleIds) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({
    name: `تذكرة-${number}`,
    type: ChannelType.GuildText,
    parent: category.id,
    permissionOverwrites: overwrites,
  });
  ticketChannelRoles[ticketChannel.id] = roleIds;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('✋ استلام').setStyle(ButtonStyle.Primary),
  );
  const roleMentions = roleIds.map(id => `<@&${id}>`).join(' ');
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`🎫 تذكرة رقم #${number}`)
    .setDescription(`أهلًا بك ${user}!\nيُرجى كتابة استفسارك أو شكواك، وسيتم الرد عليك من قِبل المسؤولين في أقرب وقت ممكن.${roleMentions ? `\n\nستتم مراجعة هذه التذكرة من قِبل ${roleMentions}` : ''}`)
    .setTimestamp();

  await ticketChannel.send({ content: `${user} ${roleMentions}`.trim(), embeds: [embed], components: [row] });
  ticketInfo[ticketChannel.id] = { openerId: user.id, categoryName: 'عام', openedAt: Date.now(), number };
  return { channel: ticketChannel, existing: null };
}

function ticketRolePrompt() {
  return new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('select_ticket_roles')
      .setPlaceholder('يُرجى تحديد الرتبة أو الرتب المسؤولة عن استلام التذاكر')
      .setMinValues(1)
      .setMaxValues(5)
  );
}

// ================= نظام أقسام التذاكر القابل للتخصيص (لوحة تحكم تفاعلية) =================
function ticketSetupEmbed(guildId) {
  const cats = ticketCategories[guildId] || [];
  const desc = cats.length
    ? cats.map(c => `${c.emoji} **${c.name}** — الرتب المسؤولة: ${c.roleIds.map(id => `<@&${id}>`).join(' ')}`).join('\n')
    : 'لا توجد أي أقسام حتى الآن. يُرجى الضغط على "➕ إضافة قسم" للبدء.';
  return new EmbedBuilder().setColor('#0099ff').setTitle('⚙️ إعداد نظام التذاكر').setDescription(desc)
    .setFooter({ text: 'أضف الأقسام التي تريدها، ثم اضغط "نشر القائمة" لعرضها للأعضاء' });
}

function ticketSetupRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_setup_add').setLabel('➕ إضافة قسم').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_setup_remove').setLabel('➖ حذف قسم').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket_setup_publish').setLabel('📤 نشر القائمة').setStyle(ButtonStyle.Primary),
  );
}

async function openTicketCategory(guild, user, category) {
  const existing = findOpenTicket(guild, user.id);
  if (existing) return { channel: null, existing };

  let cat = guild.channels.cache.find(c => c.name === 'التذاكر' && c.type === ChannelType.GuildCategory);
  if (!cat) cat = await guild.channels.create({ name: 'التذاكر', type: ChannelType.GuildCategory });

  const number = nextTicketNumber(guild.id);
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
  ];
  for (const roleId of category.roleIds) {
    overwrites.push({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ticketChannel = await guild.channels.create({ name: `تذكرة-${number}`, type: ChannelType.GuildText, parent: cat.id, permissionOverwrites: overwrites });
  ticketChannelRoles[ticketChannel.id] = category.roleIds;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('claim_ticket').setLabel('✋ استلام').setStyle(ButtonStyle.Primary),
  );
  const roleMentions = category.roleIds.map(id => `<@&${id}>`).join(' ');
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${category.emoji} تذكرة رقم #${number} — ${category.name}`)
    .setDescription(`أهلًا بك ${user}!\nيُرجى كتابة استفسارك، وسيتولى فريق **${category.name}** الرد عليك قريبًا.${roleMentions ? `\n\nستتم مراجعة هذه التذكرة من قِبل ${roleMentions}` : ''}`)
    .setTimestamp();

  await ticketChannel.send({ content: `${user} ${roleMentions}`.trim(), embeds: [embed], components: [row] });
  ticketInfo[ticketChannel.id] = { openerId: user.id, categoryName: category.name, openedAt: Date.now(), number };
  return { channel: ticketChannel, existing: null };
}

function taxEmbed(amount) {
  const amountToSend = amount / (1 - TAX_RATE);
  const taxValue = amountToSend - amount;
  return new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle('💰 حاسبة الضريبة')
    .addFields(
      { name: 'المبلغ المطلوب وصوله', value: `${amount.toLocaleString('en-US')}`, inline: true },
      { name: 'نسبة الضريبة', value: '5%', inline: true },
      { name: 'قيمة الضريبة', value: `${Math.ceil(taxValue).toLocaleString('en-US')}`, inline: true },
      { name: '📤 المبلغ الذي يجب إرساله', value: `**${Math.ceil(amountToSend).toLocaleString('en-US')}**` },
    )
    .setTimestamp();
}

// ================= تعريف أوامر السلاش (/) =================
const slashCommands = [
  new SlashCommandBuilder().setName('مساعدة').setDescription('عرض جميع أوامر البوت'),
  new SlashCommandBuilder().setName('تذكرة').setDescription('فتح تذكرة دعم جديدة'),
  new SlashCommandBuilder().setName('لوحة-تذاكر').setDescription('إرسال لوحة فتح تذاكر بزر (للإدارة فقط)'),
  new SlashCommandBuilder().setName('ضريبة').setDescription('حساب ضريبة التحويل (5%)')
    .addNumberOption(o => o.setName('amount').setDescription('المبلغ المطلوب وصوله').setRequired(true)),
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

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (['مساعدة', 'help', 'اوامر'].includes(command)) {
    return message.reply({ embeds: [helpEmbed()] });
  }

  if (['ضريبة', 'tax'].includes(command)) {
    const raw = args[0];
    if (!raw) return message.reply({ embeds: [errorEmbed('يُرجى تحديد المبلغ! مثال: !ضريبة 100000')] });
    const amount = parseFloat(raw.replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return message.reply({ embeds: [errorEmbed('يُرجى كتابة مبلغ صحيح!')] });
    return message.reply({ embeds: [taxEmbed(amount)] });
  }

  if (['تذكرة', 'شكوى'].includes(command)) {
    const { channel: ticketChannel, existing } = await openTicket(message.guild, message.author);
    if (existing) return message.reply({ embeds: [errorEmbed(`لديك تذكرة مفتوحة بالفعل: ${existing}`)] });
    return message.reply({ embeds: [successEmbed(`تم فتح تذكرتك بنجاح: ${ticketChannel}`)] });
  }

  if (['اعداد-التذاكر', 'ticket-setup'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية!')] });
    return message.reply({ embeds: [ticketSetupEmbed(message.guild.id)], components: [ticketSetupRow()] });
  }

  if (['لوحة-تذاكر', 'ticket-panel'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية!')] });
    return message.reply({ content: '👇 يُرجى تحديد الرتبة أو الرتب المسؤولة عن استلام التذاكر:', components: [ticketRolePrompt()] });
  }

  if (['روم-سجل-التذاكر', 'ticket-log'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageGuild)) return message.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية!')] });
    const channel = message.mentions.channels.first();
    if (!channel) return message.reply({ embeds: [errorEmbed('يُرجى تحديد الروم! مثال: !روم-سجل-التذاكر #سجل-التذاكر')] });
    ticketLogChannel[message.guild.id] = channel.id;
    return message.reply({ embeds: [successEmbed(`تم تحديد روم سجل التذاكر: ${channel}\nسيتم إرسال تقرير تلقائي عند إغلاق كل تذكرة.`)] });
  }

  if (['اضافة'].includes(command)) {
    if (!ticketInfo[message.channel.id]) return message.reply({ embeds: [errorEmbed('هذا الأمر يُستخدم داخل روم تذكرة فقط!')] });
    const roleIds = ticketChannelRoles[message.channel.id] || [];
    const isSupport = roleIds.length > 0 ? roleIds.some(id => message.member.roles.cache.has(id)) : hasPerm(message.member, PermissionFlagsBits.ManageGuild);
    if (!isSupport) return message.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('يُرجى تحديد العضو! مثال: !اضافة @شخص')] });
    await message.channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
    return message.reply({ embeds: [successEmbed(`تمت إضافة ${target} إلى هذه التذكرة.`)] });
  }

  if (['ازالة'].includes(command)) {
    if (!ticketInfo[message.channel.id]) return message.reply({ embeds: [errorEmbed('هذا الأمر يُستخدم داخل روم تذكرة فقط!')] });
    const roleIds = ticketChannelRoles[message.channel.id] || [];
    const isSupport = roleIds.length > 0 ? roleIds.some(id => message.member.roles.cache.has(id)) : hasPerm(message.member, PermissionFlagsBits.ManageGuild);
    if (!isSupport) return message.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('يُرجى تحديد العضو! مثال: !ازالة @شخص')] });
    await message.channel.permissionOverwrites.delete(target.id).catch(() => {});
    return message.reply({ embeds: [successEmbed(`تمت إزالة ${target} من هذه التذكرة.`)] });
  }
});

client.on('interactionCreate', async interaction => {
  // ================= لوحة إعداد التذاكر: إضافة قسم =================
  if (interaction.isButton() && interaction.customId === 'ticket_setup_add') {
    const modal = new ModalBuilder().setCustomId('ticket_category_modal').setTitle('إضافة قسم تذكرة جديد');
    const nameInput = new TextInputBuilder().setCustomId('cat_name').setLabel('اسم القسم (مثال: الدعم الفني)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(50);
    const emojiInput = new TextInputBuilder().setCustomId('cat_emoji').setLabel('إيموجي القسم (اختياري)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(10);
    modal.addComponents(new ActionRowBuilder().addComponents(nameInput), new ActionRowBuilder().addComponents(emojiInput));
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId === 'ticket_category_modal') {
    const name = interaction.fields.getTextInputValue('cat_name');
    const emoji = interaction.fields.getTextInputValue('cat_emoji') || '🎫';
    pendingCategory[interaction.user.id] = { name, emoji };
    return interaction.reply({ content: `👇 يُرجى تحديد الرتب المسؤولة عن قسم **${name}**:`, components: [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('ticket_category_roles').setPlaceholder('اختر رتبة واحدة أو أكثر').setMinValues(1).setMaxValues(5)
      )
    ], ephemeral: true });
  }

  if (interaction.isRoleSelectMenu() && interaction.customId === 'ticket_category_roles') {
    const pending = pendingCategory[interaction.user.id];
    if (!pending) return interaction.update({ content: '⚠️ حدث خطأ، يُرجى المحاولة من جديد.', components: [] });
    const category = { key: `cat_${Date.now()}`, name: pending.name, emoji: pending.emoji, roleIds: interaction.values };
    if (!ticketCategories[interaction.guild.id]) ticketCategories[interaction.guild.id] = [];
    ticketCategories[interaction.guild.id].push(category);
    delete pendingCategory[interaction.user.id];
    return interaction.update({ content: `✅ تمت إضافة القسم **${category.emoji} ${category.name}** بنجاح.`, components: [] });
  }

  // ================= لوحة إعداد التذاكر: حذف قسم =================
  if (interaction.isButton() && interaction.customId === 'ticket_setup_remove') {
    const cats = ticketCategories[interaction.guild.id] || [];
    if (cats.length === 0) return interaction.reply({ embeds: [errorEmbed('لا توجد أقسام لحذفها!')], ephemeral: true });
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_setup_remove_select').setPlaceholder('يُرجى اختيار القسم المراد حذفه')
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
    if (cats.length === 0) return interaction.reply({ embeds: [errorEmbed('يُرجى إضافة قسم واحد على الأقل قبل النشر!')], ephemeral: true });
    const menu = new StringSelectMenuBuilder().setCustomId('ticket_open_select').setPlaceholder('اختر نوع التذكرة')
      .addOptions(cats.map(c => new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.key).setEmoji(c.emoji)));
    const embed = new EmbedBuilder().setColor('#FFD700').setTitle('الدعم الفني').setDescription('يُرجى اختيار نوع التذكرة المناسب من القائمة أدناه 👇')
      .setFooter({ text: `Powered by ${BOT_NAME}`, iconURL: client.user.displayAvatarURL() });
    await interaction.channel.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] });
    return interaction.reply({ embeds: [successEmbed('تم نشر قائمة التذاكر في هذا الروم بنجاح.')], ephemeral: true });
  }

  // ================= فتح تذكرة من قائمة الأقسام =================
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_open_select') {
    const key = interaction.values[0];
    const category = (ticketCategories[interaction.guild.id] || []).find(c => c.key === key);
    if (!category) return interaction.reply({ embeds: [errorEmbed('هذا القسم لم يعد موجودًا!')], ephemeral: true });
    const { channel: ticketChannel, existing } = await openTicketCategory(interaction.guild, interaction.user, category);
    if (existing) return interaction.reply({ embeds: [errorEmbed(`لديك تذكرة مفتوحة بالفعل: ${existing}`)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed(`تم فتح تذكرتك بنجاح: ${ticketChannel}`)], ephemeral: true });
  }

  // ================= أوامر السلاش (/) =================
  if (interaction.isChatInputCommand()) {
    const cmd = interaction.commandName;

    if (cmd === 'مساعدة') return interaction.reply({ embeds: [helpEmbed()] });

    if (cmd === 'تذكرة') {
      const { channel: ticketChannel, existing } = await openTicket(interaction.guild, interaction.user);
      if (existing) return interaction.reply({ embeds: [errorEmbed(`لديك تذكرة مفتوحة بالفعل: ${existing}`)], ephemeral: true });
      return interaction.reply({ embeds: [successEmbed(`تم فتح تذكرتك بنجاح: ${ticketChannel}`)], ephemeral: true });
    }

    if (cmd === 'لوحة-تذاكر') {
      if (!hasPerm(interaction.member, PermissionFlagsBits.ManageGuild)) return interaction.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية!')], ephemeral: true });
      return interaction.reply({ content: '👇 يُرجى تحديد الرتبة أو الرتب المسؤولة عن استلام التذاكر:', components: [ticketRolePrompt()] });
    }

    if (cmd === 'ضريبة') {
      const amount = interaction.options.getNumber('amount');
      return interaction.reply({ embeds: [taxEmbed(amount)] });
    }

    return;
  }

  // ================= قائمة اختيار رولات التذاكر (النظام البسيط) =================
  if (interaction.isRoleSelectMenu() && interaction.customId === 'select_ticket_roles') {
    const roleIds = interaction.values;
    ticketRoles[interaction.guild.id] = roleIds;

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('open_ticket').setLabel('إنشاء تذكرة').setEmoji('🎫').setStyle(ButtonStyle.Secondary)
    );
    const embed = new EmbedBuilder()
      .setColor('#FFD700')
      .setTitle('الدعم الفني')
      .setDescription('يُرجى الضغط على الزر أدناه لإنشاء تذكرة دعم جديدة 🎫')
      .setFooter({ text: `Powered by ${BOT_NAME}`, iconURL: client.user.displayAvatarURL() });

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.update({ content: `✅ تم تحديد الرتب: ${roleIds.map(id => `<@&${id}>`).join(' ')}`, components: [] });
    return;
  }

  if (!interaction.isButton()) return;

  if (interaction.customId === 'open_ticket') {
    const { channel: ticketChannel, existing } = await openTicket(interaction.guild, interaction.user);
    if (existing) return interaction.reply({ embeds: [errorEmbed(`لديك تذكرة مفتوحة بالفعل: ${existing}`)], ephemeral: true });
    return interaction.reply({ embeds: [successEmbed(`تم فتح تذكرتك بنجاح: ${ticketChannel}`)], ephemeral: true });
  }

  if (interaction.customId === 'close_ticket') {
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_close_ticket').setLabel('تأكيد الإغلاق').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('cancel_close_ticket').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({ embeds: [new EmbedBuilder().setColor('#ff9900').setDescription('⚠️ هل أنت متأكد من رغبتك في إغلاق هذه التذكرة؟')], components: [confirmRow] });
  }

  if (interaction.customId === 'cancel_close_ticket') {
    return interaction.update({ embeds: [successEmbed('تم إلغاء عملية الإغلاق.')], components: [] });
  }

  if (interaction.customId === 'confirm_close_ticket') {
    await interaction.update({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('🔒 سيتم إغلاق التذكرة خلال خمس ثوانٍ...')], components: [] });

    const logChannelId = ticketLogChannel[interaction.guild.id];
    const info = ticketInfo[interaction.channel.id];
    if (logChannelId && info) {
      const logChannel = interaction.guild.channels.cache.get(logChannelId);
      if (logChannel) {
        const opener = await interaction.guild.members.fetch(info.openerId).catch(() => null);
        const durationMin = Math.round((Date.now() - info.openedAt) / 60000);
        const logEmbed = new EmbedBuilder()
          .setColor('#2f3136')
          .setTitle('📁 سجل إغلاق تذكرة')
          .addFields(
            { name: 'رقم التذكرة', value: `#${info.number || '—'}`, inline: true },
            { name: 'القسم', value: info.categoryName, inline: true },
            { name: 'فتحها', value: opener ? opener.user.tag : info.openerId, inline: true },
            { name: 'أغلقها', value: interaction.user.tag, inline: true },
            { name: 'مدة التذكرة', value: `${durationMin} دقيقة`, inline: true },
          )
          .setTimestamp();
        logChannel.send({ embeds: [logEmbed] }).catch(() => {});
      }
    }
    delete ticketInfo[interaction.channel.id];
    delete ticketChannelRoles[interaction.channel.id];

    setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
  }

  if (interaction.customId === 'call_owner') {
    const owner = await interaction.guild.fetchOwner();
    await interaction.reply({ content: `🔔 عزيزي ${owner}، تم استدعاؤك من قِبل ${interaction.user} بخصوص هذه التذكرة.` });
  }

  if (interaction.customId === 'claim_ticket') {
    const roleIds = ticketChannelRoles[interaction.channel.id] || ticketRoles[interaction.guild.id] || (TICKET_ROLE_ID ? [TICKET_ROLE_ID] : []);
    const isSupport = roleIds.length > 0
      ? roleIds.some(id => interaction.member.roles.cache.has(id))
      : interaction.member.permissions.has(PermissionFlagsBits.ManageGuild);
    if (!isSupport) return interaction.reply({ embeds: [errorEmbed('ليست لديك الصلاحية الكافية لاستلام هذه التذكرة!')], ephemeral: true });
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });

    const claimedRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('call_owner').setLabel('👑 استدعاء المالك').setStyle(ButtonStyle.Secondary),
    );
    await interaction.message.edit({ components: [claimedRow] });
    await interaction.reply({ embeds: [successEmbed(`تم استلام هذه التذكرة من قِبل ${interaction.user}`)] });
  }
});

client.once('ready', async () => {
  console.log(`✅ ${BOT_NAME} جاهز | ${client.user.tag}`);
  client.user.setActivity(`!مساعدة | ${BOT_NAME}`, { type: 0 });
  await registerSlashCommands();
});

client.login(process.env.TOKEN);
