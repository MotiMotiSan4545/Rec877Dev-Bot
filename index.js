const { Client, GatewayIntentBits, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder, ChannelType } = require('discord.js');
const crypto = require('crypto');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ]
});

// 設定
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || '';
const AUTH_WEBSITE_URL = process.env.AUTH_WEBSITE_URL || 'https://verify.rec877.com';
const VERIFIED_ROLE_ID = '1450083929129226291';
const TICKET_ROLE_ID = '1456828184384376905';
const STAFF_ROLE_ID = '1450083867401654346';

// 認証セッション管理用(Redis推奨だが、簡易的にメモリに保存)
const authSessions = new Map();

// スパム検知用のメッセージキャッシュ
const messageCache = new Map();

client.once('ready', () => {
  console.log(`✅ ログイン成功: ${client.user.tag}`);
  
  // スラッシュコマンドの登録
  const commands = [
    {
      name: 'verify',
      description: '認証パネルを表示します(管理者のみ)',
      default_member_permissions: PermissionFlagsBits.Administrator.toString()
    },
    {
      name: 'ticket',
      description: 'チケットパネルを表示します(管理者のみ)',
      default_member_permissions: PermissionFlagsBits.Administrator.toString()
    },
    {
      name: 'ticket_close',
      description: 'チケットを閉じます',
    }
  ];

  client.application.commands.set(commands);
});

// /verifyコマンド
client.on('interactionCreate', async interaction => {
  if (!interaction.isCommand()) return;

  if (interaction.commandName === 'verify') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ このコマンドは管理者のみ実行できます。', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🔐 認証パネル')
      .setDescription('以下のボタンを押して認証を完了してください。\n認証後、サーバーの全機能をご利用いただけます。')
      .setColor(0x5865F2)
      .addFields({ name: '注意事項', value: '• VPN接続での認証はできません\n• CloudFlare認証が必要です\n• 認証は1回のみ有効です' });

    const button = new ButtonBuilder()
      .setCustomId('start_verification')
      .setLabel('認証を開始')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✅');

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  if (interaction.commandName === 'ticket') {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ このコマンドは管理者のみ実行できます。', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🎫 チケットパネル')
      .setDescription('お問い合わせがある場合は、以下のボタンからチケットを作成してください。')
      .setColor(0x57F287)
      .addFields({ name: '注意事項', value: '• いたずらでのチケット作成は禁止です\n• 違反した場合、処罰される可能性があります' });

    const button = new ButtonBuilder()
      .setCustomId('create_ticket')
      .setLabel('チケットを作成')
      .setStyle(ButtonStyle.Success)
      .setEmoji('📝');

    const row = new ActionRowBuilder().addComponents(button);

    await interaction.reply({ embeds: [embed], components: [row] });
  }

  if (interaction.commandName === 'ticket_close') {
    if (interaction.channel.isThread()) {
      await interaction.reply('✅ チケットを閉じています...');
      await interaction.channel.setArchived(true);
      
      setTimeout(async () => {
        try {
          await interaction.channel.delete();
        } catch (error) {
          console.error('スレッド削除エラー:', error);
        }
      }, 5000);
    } else {
      await interaction.reply({ content: '❌ このコマンドはチケットスレッド内でのみ実行できます。', ephemeral: true });
    }
  }
});

// ボタンとセレクトメニューの処理
client.on('interactionCreate', async interaction => {
  // 認証ボタン
  if (interaction.isButton() && interaction.customId === 'start_verification') {
    const sessionId = crypto.randomUUID();
    authSessions.set(sessionId, {
      userId: interaction.user.id,
      guildId: interaction.guild.id,
      timestamp: Date.now()
    });

    // 10分後に自動削除
    setTimeout(() => {
      authSessions.delete(sessionId);
    }, 10 * 60 * 1000);

    const authUrl = `${AUTH_WEBSITE_URL}/rec877dev/${sessionId}`;
    
    await interaction.reply({
      content: `🔗 以下のリンクから認証を完了してください:\n${authUrl}\n\n⚠️ このリンクは10分間有効です。`,
      ephemeral: true
    });
  }

  // チケット作成ボタン
  if (interaction.isButton() && interaction.customId === 'create_ticket') {
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId('ticket_category')
      .setPlaceholder('お問い合わせの種類を選択してください')
      .addOptions([
        {
          label: 'Rec Wikiに関するお問い合わせ',
          value: 'wiki',
          emoji: '📚'
        },
        {
          label: 'Discordサーバーに関するお問い合わせ',
          value: 'discord',
          emoji: '💬'
        },
        {
          label: 'その他',
          value: 'other',
          emoji: '❓'
        }
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
      content: 'お問い合わせの種類を選択してください:',
      components: [row],
      ephemeral: true
    });
  }

  // カテゴリー選択
  if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category') {
    const category = interaction.values[0];
    
    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${category}`)
      .setTitle('チケット作成');

    const titleInput = new TextInputBuilder()
      .setCustomId('ticket_title')
      .setLabel('お問い合わせタイトル')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(100);

    const row = new ActionRowBuilder().addComponents(titleInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }

  // モーダル送信
  if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket_modal_')) {
    const category = interaction.customId.replace('ticket_modal_', '');
    const title = interaction.fields.getTextInputValue('ticket_title');

    const categoryNames = {
      wiki: 'Rec Wiki',
      discord: 'Discordサーバー',
      other: 'その他'
    };

    // ロール付与
    try {
      const member = interaction.member;
      await member.roles.add(TICKET_ROLE_ID);
    } catch (error) {
      console.error('ロール付与エラー:', error);
    }

    // スレッド作成
    const thread = await interaction.channel.threads.create({
      name: `${categoryNames[category]} - ${title}`,
      autoArchiveDuration: 1440,
      type: ChannelType.PrivateThread,
      reason: `チケット作成: ${interaction.user.tag}`
    });

    await thread.members.add(interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle('🎫 チケットが作成されました')
      .setDescription(`<@${interaction.user.id}>さん、お問い合わせありがとうございます。\n<@${STAFF_ROLE_ID}>が対応しますので、もう少しお待ちください。\n\nまた、いたずら等で作成を繰り返している場合、処罰される可能性があります。`)
      .setColor(0x57F287)
      .addFields(
        { name: 'カテゴリー', value: categoryNames[category], inline: true },
        { name: 'タイトル', value: title, inline: true }
      )
      .setTimestamp();

    await thread.send({ embeds: [embed] });

    await interaction.reply({
      content: `✅ チケットが作成されました: ${thread}`,
      ephemeral: true
    });
  }
});

// メッセージ監視(スパム・荒らし検知)
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const userId = message.author.id;
  const now = Date.now();

  // メッセージキャッシュの初期化
  if (!messageCache.has(userId)) {
    messageCache.set(userId, []);
  }

  const userMessages = messageCache.get(userId);
  userMessages.push({ content: message.content, timestamp: now, attachments: message.attachments });

  // 5秒以内のメッセージのみ保持
  const recentMessages = userMessages.filter(msg => now - msg.timestamp < 5000);
  messageCache.set(userId, recentMessages);

  let shouldTimeout = false;
  let reason = '';

  // スパム検知(5秒以内に5件以上のメッセージ)
  if (recentMessages.length >= 5) {
    shouldTimeout = true;
    reason = 'スパム行為';
  }

  // 同一メッセージの連投検知
  const sameMessages = recentMessages.filter(msg => msg.content === message.content);
  if (sameMessages.length >= 3 && message.content.length > 0) {
    shouldTimeout = true;
    reason = 'メッセージの連投';
  }

  // トークンっぽい文字列の検知(簡易的)
  if (message.content.match(/[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/)) {
    shouldTimeout = true;
    reason = 'トークンの投稿';
    try {
      await message.delete();
    } catch (error) {
      console.error('メッセージ削除エラー:', error);
    }
  }

  // 点滅GIFの検知(簡易的 - ファイル名で判定)
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType?.startsWith('image/gif')) {
      shouldTimeout = true;
      reason = '点滅GIFの投稿';
      try {
        await message.delete();
      } catch (error) {
        console.error('メッセージ削除エラー:', error);
      }
    }
  }

  // タイムアウト実行
  if (shouldTimeout) {
    try {
      await message.member.timeout(5 * 60 * 1000, reason);
      const embed = new EmbedBuilder()
        .setTitle('⚠️ タイムアウト')
        .setDescription(`${message.author}さんが**${reason}**により5分間タイムアウトされました。`)
        .setColor(0xED4245)
        .setTimestamp();
      
      await message.channel.send({ embeds: [embed] });
    } catch (error) {
      console.error('タイムアウトエラー:', error);
    }
  }
});

// 認証完了時の処理(Webhookで呼び出される)
// Express APIを小さく追加
const express = require('express');
const app = express();
app.use(express.json());

// 認証Webhookエンドポイント
app.post('/api/verify-callback', async (req, res) => {
  const { sessionId, userId, guildId } = req.body;
  
  // セッション検証
  const session = authSessions.get(sessionId);
  if (!session || session.userId !== userId || session.guildId !== guildId) {
    return res.status(400).json({ success: false, message: '無効なセッションです。' });
  }

  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);
    await member.roles.add(VERIFIED_ROLE_ID);
    
    authSessions.delete(sessionId);
    
    res.json({ success: true, message: 'ロール付与完了' });
  } catch (error) {
    console.error('ロール付与エラー:', error);
    res.status(500).json({ success: false, message: 'ロール付与に失敗しました。' });
  }
});

// セッション検証エンドポイント
app.get('/api/verify-session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = authSessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ valid: false });
  }
  
  const elapsed = Date.now() - session.timestamp;
  if (elapsed > 10 * 60 * 1000) {
    authSessions.delete(sessionId);
    return res.status(404).json({ valid: false });
  }
  
  res.json({
    valid: true,
    userId: session.userId,
    guildId: session.guildId
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`✅ Webhook APIサーバー起動: ポート ${PORT}`);
});

client.login(DISCORD_TOKEN);
