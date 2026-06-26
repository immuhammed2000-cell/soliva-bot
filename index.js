const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, Collection
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
const cooldowns = new Collection();

function getXP(userId) {
  if (!xpData[userId]) xpData[userId] = { xp: 0, level: 1 };
  return xpData[userId];
}

function addXP(userId, amount) {
  const data = getXP(userId);
  data.xp += amount;
  const needed = data.level * 100;
  if (data.xp >= needed) {
    data.xp -= needed;
    data.level++;
    return true;
  }
  return false;
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
});client.on('messageCreate', async message => {
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

  if (['مساعدة','help','اوامر'].includes(command)) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('📋 أوامر Soliva Bot')
      .addFields(
        { name: '🛡️ الإدارة', value: '`!كيك` `!باند` `!رفع-باند` `!تحذير` `!تحذيرات` `!مسح-تحذيرات` `!كتم` `!رفع-كتم` `!مسح`' },
        { name: '📊 المستويات', value: '`!رتبتي` `!لوحة-الصدارة`' },
        { name: '🎫 التذاكر', value: '`!تذكرة`' },
        { name: '👤 معلومات', value: '`!معلوماتي` `!سيرفر` `!بوت` `!بينغ`' },
        { name: '🎮 ترفيه', value: '`!تقليب-عملة` `!عشوائي` `!اختر`' },
      )
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (['كيك','طرد'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.KickMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    const reason = args.slice(1).join(' ') || 'بدون سبب';
    await target.kick(reason);
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ff6600').setTitle('👢 تم الطرد').addFields({name:'العضو',value:target.user.tag,inline:true},{name:'السبب',value:reason}).setTimestamp()] });
  }

  if (['باند','حظر'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.BanMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    const reason = args.slice(1).join(' ') || 'بدون سبب';
    await target.ban({ reason });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ff0000').setTitle('🔨 تم الحظر').addFields({name:'العضو',value:target.user.tag,inline:true},{name:'السبب',value:reason}).setTimestamp()] });
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
    warnings[target.id].push({ reason, date: new Date().toLocaleDateString('ar'), mod: message.author.tag });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setTitle('⚠️ تحذير').addFields({name:'العضو',value:target.user.tag,inline:true},{name:'إجمالي',value:`${warnings[target.id].length}`,inline:true},{name:'السبب',value:reason}).setTimestamp()] });
  }

  if (['تحذيرات'].includes(command)) {
    const target = message.mentions.members.first() || message.member;
    const w = warnings[target.id];
    if (!w || w.length === 0) return message.reply({ embeds: [successEmbed(`${target.user.tag} ما عنده تحذيرات`)] });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#ffaa00').setTitle(`⚠️ تحذيرات ${target.user.tag}`).setDescription(w.map((x,i)=>`**${i+1}.** ${x.reason} | ${x.date}`).join('\n'))] });
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
    return message.reply({ embeds: [new EmbedBuilder().setColor('#888888').setTitle('🔇 تم الكتم').addFields({name:'العضو',value:target.user.tag,inline:true},{name:'المدة',value:`${minutes} دقيقة`,inline:true},{name:'السبب',value:reason}).setTimestamp()] });
  }

  if (['رفع-كتم'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ModerateMembers)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const target = message.mentions.members.first();
    if (!target) return message.reply({ embeds: [errorEmbed('حدد العضو!')] });
    await target.timeout(null);
    return message.reply({ embeds: [successEmbed(`تم رفع الكتم عن ${target.user.tag}`)] });
  }

  if (['مسح','clear'].includes(command)) {
    if (!hasPerm(message.member, PermissionFlagsBits.ManageMessages)) return message.reply({ embeds: [errorEmbed('ما عندك صلاحية!')] });
    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100) return message.reply({ embeds: [errorEmbed('حدد عدد بين 1 و 100!')] });
    await message.channel.bulkDelete(amount + 1, true);
    const msg = await message.channel.send({ embeds: [successEmbed(`تم مسح ${amount} رسالة`)] });
    setTimeout(() => msg.delete(), 3000);
                                    }if (['رتبتي','rank'].includes(command)) {
    const target = message.mentions.members.first() || message.member;
    const data = getXP(target.id);
    const needed = data.level * 100;
    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle(`📊 رتبة ${target.user.tag}`).setThumbnail(target.user.displayAvatarURL({dynamic:true})).addFields({name:'⭐ المستوى',value:`${data.level}`,inline:true},{name:'✨ الـ XP',value:`${data.xp} / ${needed}`,inline:true}).setTimestamp()] });
  }

  if (['لوحة-الصدارة','lb'].includes(command)) {
    const sorted = Object.entries(xpData).sort((a,b)=>b[1].level-a[1].level||b[1].xp-a[1].xp).slice(0,10);
    if (sorted.length === 0) return message.reply({ embeds: [errorEmbed('ما في بيانات بعد!')] });
    const medals = ['🥇','🥈','🥉'];
    const desc = sorted.map(([id,d],i)=>`${medals[i]||`**${i+1}.**`} <@${id}> - المستوى ${d.level} | XP: ${d.xp}`).join('\n');
    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🏆 لوحة الصدارة').setDescription(desc).setTimestamp()] });
  }

  if (['معلوماتي','whois'].includes(command)) {
    const target = message.mentions.members.first() || message.member;
    const roles = target.roles.cache.filter(r=>r.id!==message.guild.id).map(r=>r.toString()).join(', ')||'لا يوجد';
    return message.reply({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle(`👤 معلومات ${target.user.tag}`).setThumbnail(target.user.displayAvatarURL({dynamic:true})).addFields({name:'الاسم',value:target.user.tag,inline:true},{name:'الـ ID',value:target.id,inline:true},{name:'أعلى رتبة',value:target.roles.highest.name,inline:true},{name:'تاريخ الانضمام',value:target.joinedAt.toLocaleDateString('ar'),inline:true},{name:'الرتب',value:roles}).setTimestamp()] });
  }

  if (['سيرفر','serverinfo'].includes(command)) {
    const guild = message.guild;
    return message.reply({ embeds: [new EmbedBuilder().setColor('#0099ff').setTitle(`🏠 معلومات ${guild.name}`).setThumbnail(guild.iconURL({dynamic:true})).addFields({name:'👑 المالك',value:`<@${guild.ownerId}>`,inline:true},{name:'👥 الأعضاء',value:`${guild.memberCount}`,inline:true},{name:'📅 الإنشاء',value:guild.createdAt.toLocaleDateString('ar'),inline:true},{name:'💬 القنوات',value:`${guild.channels.cache.size}`,inline:true}).setTimestamp()] });
  }

  if (['بوت'].includes(command)) {
    return message.reply({ embeds: [new EmbedBuilder().setColor('#7289da').setTitle('🤖 Soliva Bot').addFields({name:'🏓 البينغ',value:`${client.ws.ping}ms`,inline:true},{name:'⏱️ التشغيل',value:`${Math.floor(process.uptime()/60)} دقيقة`,inline:true},{name:'🌐 السيرفرات',value:`${client.guilds.cache.size}`,inline:true}).setTimestamp()] });
  }

  if (['بينغ'].includes(command)) {
    return message.reply({ embeds: [new EmbedBuilder().setColor('#00ff00').setDescription(`🏓 البينغ: **${client.ws.ping}ms**`)] });
  }

  if (['تقليب-عملة'].includes(command)) {
    const result = Math.random() < 0.5 ? '👑 صورة' : '🔵 كتابة';
    return message.reply({ embeds: [new EmbedBuilder().setColor('#FFD700').setTitle('🪙 تقليب العملة').setDescription(`النتيجة: **${result}**`)] });
  }

  if (['عشوائي'].includes(command)) {
    const min = parseInt(args[0])||1, max = parseInt(args[1])||100;
    return message.reply({ embeds: [new EmbedBuilder().setColor('#7289da').setTitle('🎲 رقم عشوائي').setDescription(`النتيجة: **${Math.floor(Math.random()*(max-min+1))+min}**`)] });
  }

  if (['اختر'].includes(command)) {
    const choices = args.join(' ').split('،');
    if (choices.length < 2) return message.reply({ embeds: [errorEmbed('أضف خيارين مفصولة بـ ،')] });
    return message.reply({ embeds: [new EmbedBuilder().setColor('#00ff99').setTitle('🤔 اخترت لك').setDescription(`**${choices[Math.floor(Math.random()*choices.length)].trim()}**`)] });
  }

  if (['تذكرة','شكوى'].includes(command)) {
    const existing = message.guild.channels.cache.find(c=>c.name===`تذكرة-${message.author.username}`);
    if (existing) return message.reply({ embeds: [errorEmbed(`عندك تذكرة مفتوحة: ${existing}`)] });
    let category = message.guild.channels.cache.find(c=>c.name==='التذاكر'&&c.type===ChannelType.GuildCategory);
    if (!category) category = await message.guild.channels.create({name:'التذاكر',type:ChannelType.GuildCategory});
    const ticketChannel = await message.guild.channels.create({
      name:`تذكرة-${message.author.username}`,
      type:ChannelType.GuildText,
      parent:category.id,
      permissionOverwrites:[
        {id:message.guild.id,deny:[PermissionFlagsBits.ViewChannel]},
        {id:message.author.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
      ]
    });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('close_ticket').setLabel('🔒 إغلاق التذكرة').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('claim_ticket').setLabel('✋ استلام').setStyle(ButtonStyle.Primary),
    );
    const embed = new EmbedBuilder().setColor('#0099ff').setTitle('🎫 تذكرة جديدة').setDescription(`مرحباً ${message.author}!\nاكتب شكواك وسيرد عليك المسؤولون قريباً.`).setTimestamp();
    await ticketChannel.send({content:`${message.author}`,embeds:[embed],components:[row]});
    return message.reply({ embeds: [successEmbed(`تم فتح تذكرتك: ${ticketChannel}`)] });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  if (interaction.customId === 'close_ticket') {
    await interaction.reply({ embeds: [new EmbedBuilder().setColor('#ff0000').setDescription('🔒 سيتم إغلاق التذكرة خلال 5 ثواني...')] });
    setTimeout(() => interaction.channel.delete().catch(()=>{}), 5000);
  }
  if (interaction.customId === 'claim_ticket') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return interaction.reply({ embeds: [errorEmbed('ما عندك صلاحية!')], ephemeral: true });
    await interaction.channel.permissionOverwrites.edit(interaction.user.id, {ViewChannel:true,SendMessages:true,ReadMessageHistory:true});
    await interaction.reply({ embeds: [successEmbed(`تم استلام التذكرة من قبل ${interaction.user}`)] });
  }
});

client.once('ready', () => {
  console.log(`✅ Soliva Bot جاهز | ${client.user.tag}`);
  client.user.setActivity('!مساعدة | Soliva Bot', { type: 0 });
});

client.login(process.env.TOKEN);
