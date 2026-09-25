import {
  ChannelType, Client, Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from "discord.js";
import {
  VoiceConnectionStatus, entersState, getVoiceConnection, joinVoiceChannel,
} from "@discordjs/voice";
import { log } from "./report.js";

// View Channel + Connect + Send Messages (aviso de gravação no chat do canal de voz)
export const INVITE_PERMISSIONS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect
  | PermissionFlagsBits.SendMessages;

const commands = [
  new SlashCommandBuilder()
    .setName("entrar")
    .setDescription("O bot entra no seu canal de voz para animar os retratos no Foundry.")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("sair")
    .setDescription("O bot sai do canal de voz.")
    .toJSON(),
];

/**
 * Cuida da conexão com o Discord: segue o GM pelos canais de voz e avisa
 * quando alguém começa ou para de falar. A gravação fica no Recorder.
 *
 * Callbacks:
 *  onSpeaking(userId, speaking)
 *  onChange()  — canal, membros ou status mudaram
 */
export class VoiceWatcher {
  constructor(cfg, { onSpeaking, onChange }) {
    this.cfg = cfg;
    this.onSpeaking = onSpeaking;
    this.onChange = onChange;
    this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    this.channelId = null;
    this.voiceStatus = "idle"; // idle | connecting | ready | reconnecting
    this.speaking = new Set();
    this.guild = null;
    this.ready = false;
    this.gatewayUp = false;
    this.readyAt = 0;
    this._wire();
  }

  async login() {
    await this.client.login(this.cfg.token);
  }

  destroy() {
    this.leave("encerrando");
    return this.client.destroy();
  }

  // ---- estado para o Foundry e para o app ---------------------------------

  members() {
    if (!this.guild || !this.channelId) return [];
    const channel = this.guild.channels.cache.get(this.channelId);
    if (!channel?.isVoiceBased()) return [];
    return [...channel.members.values()]
      .filter(m => !m.user.bot)
      .map(m => ({
        id: m.id,
        name: m.displayName,
        username: m.user.username,
        avatar: m.displayAvatarURL({ size: 64, extension: "png" }),
        speaking: this.speaking.has(m.id),
      }));
  }

  /** Conexão de voz atual, se houver. */
  connection() {
    return this.guild ? getVoiceConnection(this.guild.id) ?? null : null;
  }

  /** Manda um aviso no chat do canal de voz em que o bot está. */
  async announce(text) {
    const channel = this.channelId ? this.guild?.channels.cache.get(this.channelId) : null;
    if (!channel?.isTextBased()) return;
    const me = this.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      log("warn", `Sem permissão para avisar no chat de "${channel.name}". Reconvide o bot com o link de convite (agora ele pede "Enviar mensagens").`);
      return;
    }
    try {
      await channel.send({ content: text, allowedMentions: { parse: [] } });
    } catch (err) {
      log("warn", `Não consegui avisar no chat de "${channel.name}": ${err.message}`);
    }
  }

  channelInfo() {
    if (!this.guild || !this.channelId) return null;
    const channel = this.guild.channels.cache.get(this.channelId);
    return { id: this.channelId, name: channel?.name ?? "?" };
  }

  inviteUrl() {
    const id = this.client.application?.id ?? this.client.user?.id;
    if (!id) return "";
    const params = new URLSearchParams({
      client_id: id,
      scope: "bot applications.commands",
      permissions: INVITE_PERMISSIONS.toString(),
    });
    if (this.cfg.guildId) params.set("guild_id", this.cfg.guildId);
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  // ---- entrar e sair do canal --------------------------------------------

  async join(channelId, reason) {
    if (!this.guild) return { ok: false, text: "O bot não está no servidor configurado." };
    const channel = this.guild.channels.cache.get(channelId);
    if (!channel?.isVoiceBased()) return { ok: false, text: "Canal de voz não encontrado." };
    const me = this.guild.members.me;
    const perms = me ? channel.permissionsFor(me) : null;
    if (perms && !perms.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])) {
      return { ok: false, text: `Sem permissão para entrar em "${channel.name}" (precisa de Ver canal e Conectar).` };
    }
    if (this.channelId === channelId && getVoiceConnection(this.guild.id)) {
      return { ok: true, text: `Já estou em "${channel.name}".` };
    }

    // Trocar de canal: encerra a conexão anterior para não acumular ouvintes.
    const previous = getVoiceConnection(this.guild.id);
    if (previous) {
      previous.removeAllListeners();
      previous.receiver.speaking.removeAllListeners();
      previous.destroy();
    }
    this._clearSpeaking();
    this.channelId = channelId;
    this.voiceStatus = "connecting";
    this.onChange();
    log("info", `Entrando em "${channel.name}" (${reason})…`);

    const connection = joinVoiceChannel({
      channelId,
      guildId: this.guild.id,
      adapterCreator: this.guild.voiceAdapterCreator,
      selfDeaf: false, // surdo, o Discord não manda os pacotes de voz e não há eventos de fala
      selfMute: true,
    });
    this._watchConnection(connection, channelId);
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
      return { ok: true, text: `Entrei em "${channel.name}".` };
    } catch {
      if (this.channelId === channelId && connection.state.status !== VoiceConnectionStatus.Ready) {
        log("err", `Não consegui conectar ao canal "${channel.name}" em 20 s.`);
        this.leave("falha ao conectar");
      }
      return { ok: false, text: `Não consegui conectar em "${channel.name}".` };
    }
  }

  leave(reason) {
    const connection = this.guild ? getVoiceConnection(this.guild.id) : null;
    const had = this.channelId || connection;
    const info = this.channelInfo();
    this.channelId = null;
    this.voiceStatus = "idle";
    this._clearSpeaking();
    if (connection) connection.destroy();
    if (had) {
      log("info", `Saí do canal${info ? ` "${info.name}"` : ""} (${reason}).`);
      this.onChange();
    }
  }

  /** Canal em que o GM está agora, se for um que podemos seguir. */
  gmChannel() {
    const state = this.guild?.voiceStates.cache.get(this.cfg.gmId);
    const id = state?.channelId ?? null;
    if (!id) return null;
    if (this.cfg.voiceChannelId && id !== this.cfg.voiceChannelId) return null;
    return id;
  }

  // ---- internos -----------------------------------------------------------

  _clearSpeaking() {
    for (const id of this.speaking) this.onSpeaking(id, false);
    this.speaking.clear();
  }

  _watchConnection(connection, channelId) {
    const current = () => this.channelId === channelId && getVoiceConnection(this.guild.id) === connection;

    connection.on("stateChange", async (oldState, newState) => {
      if (!current()) return;
      if (newState.status === VoiceConnectionStatus.Ready) {
        this.voiceStatus = "ready";
        log("ok", `Conectado à voz em "${this.channelInfo()?.name}". Ouvindo quem fala.`);
        this.onChange();
      } else if (newState.status === VoiceConnectionStatus.Disconnected) {
        this.voiceStatus = "reconnecting";
        this.onChange();
        // Movido de canal ou queda momentânea: o Discord tenta sozinho por alguns segundos.
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          if (current()) {
            log("warn", "Conexão de voz caiu e não voltou.");
            this.leave("desconectado");
            this._followGmSoon();
          }
        }
      } else if (newState.status === VoiceConnectionStatus.Destroyed) {
        if (current()) this.leave("conexão encerrada");
      } else if (oldState.status === VoiceConnectionStatus.Ready) {
        this.voiceStatus = "reconnecting";
        this.onChange();
      }
    });
    connection.on("error", err => log("err", `Erro na conexão de voz: ${err.message}`));

    const speaking = connection.receiver.speaking;
    speaking.on("start", userId => {
      if (!current() || this.speaking.has(userId)) return;
      this.speaking.add(userId);
      log("speak", `▶ ${this._name(userId)} começou a falar`);
      this.onSpeaking(userId, true);
    });
    speaking.on("end", userId => {
      if (!current() || !this.speaking.delete(userId)) return;
      log("speak", `■ ${this._name(userId)} parou de falar`);
      this.onSpeaking(userId, false);
    });
  }

  _name(userId) {
    const m = this.guild?.members.cache.get(userId);
    return m ? m.displayName : userId;
  }

  _followGmSoon() {
    setTimeout(() => {
      if (this.channelId) return;
      const id = this.gmChannel();
      if (id) this.join(id, "o GM está em um canal de voz");
    }, 3_000);
  }

  _wire() {
    const c = this.client;

    c.once(Events.ClientReady, async client => {
      this.ready = true;
      this.gatewayUp = true;
      this.readyAt = Date.now();
      log("ok", `Conectado ao Discord como ${client.user.tag}`);
      await client.application?.fetch().catch(() => {});
      try {
        this.guild = await client.guilds.fetch(this.cfg.guildId);
      } catch {
        this.guild = null;
      }
      if (!this.guild) {
        log("err", "O bot não está no servidor do GUILD_ID. Convide-o com o link de convite.");
        log("info", `Link de convite: ${this.inviteUrl()}`);
        this.onChange();
        return;
      }
      log("ok", `Servidor: ${this.guild.name}`);
      try {
        await this.guild.commands.set(commands);
        log("info", "Comandos /entrar e /sair registrados.");
      } catch (err) {
        log("warn", `Não consegui registrar os comandos (${err.message}). Reconvide o bot com o link de convite.`);
      }
      try {
        const gm = await this.guild.members.fetch(this.cfg.gmId);
        log("info", `GM: ${gm.displayName}`);
      } catch {
        log("warn", "GM_DISCORD_ID não é membro deste servidor. A entrada automática não vai funcionar.");
      }
      this.onChange();
      const id = this.gmChannel();
      if (id) await this.join(id, "o GM já estava em um canal de voz");
      else log("info", "Esperando o GM entrar num canal de voz (ou use /entrar).");
    });

    c.on(Events.ShardDisconnect, () => { this.gatewayUp = false; this.onChange(); });
    c.on(Events.ShardReconnecting, () => { this.gatewayUp = false; this.onChange(); });
    c.on(Events.ShardResume, () => { this.gatewayUp = true; this.onChange(); });
    c.on(Events.ShardReady, () => { this.gatewayUp = true; this.onChange(); });
    c.on(Events.Error, err => log("err", `Erro do Discord: ${err.message}`));
    c.on(Events.Warn, msg => log("warn", msg));

    c.on(Events.VoiceStateUpdate, (oldState, newState) => {
      if (!this.guild || newState.guild.id !== this.guild.id) return;
      const userId = newState.id;

      if (userId === c.user.id) {
        // Alguém moveu ou desconectou o bot pela interface do Discord.
        if (!newState.channelId && this.channelId) this.leave("desconectado por alguém");
        else if (newState.channelId && this.channelId && newState.channelId !== this.channelId) {
          this.channelId = newState.channelId;
          this._clearSpeaking();
          log("info", `Fui movido para "${this.channelInfo()?.name}".`);
        }
        this.onChange();
        return;
      }

      if (userId === this.cfg.gmId && oldState.channelId !== newState.channelId) {
        const target = this.gmChannel();
        if (target && target !== this.channelId) this.join(target, "o GM entrou no canal");
        else if (!newState.channelId && this.channelId) this.leave("o GM saiu da voz");
      }

      if (this.channelId && (oldState.channelId === this.channelId || newState.channelId === this.channelId)) {
        if (newState.channelId !== this.channelId && this.speaking.delete(userId)) this.onSpeaking(userId, false);
        const name = newState.member?.displayName ?? userId;
        if (!newState.member?.user.bot) {
          if (oldState.channelId !== this.channelId && newState.channelId === this.channelId) log("info", `${name} entrou na call`);
          else if (oldState.channelId === this.channelId && newState.channelId !== this.channelId) log("info", `${name} saiu da call`);
        }
        this.onChange();
      }
    });

    c.on(Events.InteractionCreate, async interaction => {
      if (!interaction.isChatInputCommand() || interaction.guildId !== this.guild?.id) return;
      const reply = text => interaction.reply({ content: text, flags: MessageFlags.Ephemeral }).catch(() => {});
      if (interaction.commandName === "entrar") {
        const channelId = interaction.guild.voiceStates.cache.get(interaction.user.id)?.channelId;
        if (!channelId) return reply("Entre num canal de voz primeiro.");
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});
        const res = await this.join(channelId, `/entrar de ${interaction.member?.displayName ?? interaction.user.username}`);
        await interaction.editReply(res.text).catch(() => {});
      } else if (interaction.commandName === "sair") {
        if (!this.channelId) return reply("Não estou em nenhum canal de voz.");
        this.leave(`/sair de ${interaction.member?.displayName ?? interaction.user.username}`);
        return reply("Saí do canal de voz.");
      }
    });
  }

  /** Lista de canais de voz do servidor (para o app). */
  voiceChannels() {
    if (!this.guild) return [];
    return [...this.guild.channels.cache.values()]
      .filter(ch => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map(ch => ({ id: ch.id, name: ch.name }));
  }
}
