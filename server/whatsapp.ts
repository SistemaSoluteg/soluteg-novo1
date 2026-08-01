import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg as any;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';

// Configuração do Cliente Puppeteer para VPS
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './sessions' }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu' // Adicione esta linha
        ]
    }
});

let isReady = false;
let lastQrDataUrl: string | null = null; // Último QR code como imagem (data URL)

// Evento: Gerar QR Code no Terminal + armazenar como imagem
client.on('qr', async (qr) => {
    console.log('--- LEIA O QR CODE PARA CONECTAR O ZAP DA JNC ---');
    qrcode.generate(qr, { small: true });
    try {
        lastQrDataUrl = await QRCode.toDataURL(qr);
    } catch (err: any) {
        console.error('Erro ao gerar QR como imagem:', err?.message);
    }
});

// Evento: Conexão Estabelecida
client.on('ready', async () => {
    isReady = true;
    lastQrDataUrl = null; // QR não é mais necessário após conectar
    console.log('✅ WHATSAPP DA JNC ELÉTRICA e BOMBAS ON!');

    // Aguarda 8s para garantir que o client está estável antes de enviar.
    // Usa sendWhatsappAlert em vez de client.sendMessage direto: valida o número
    // com getNumberId() (tenta ambos os formatos: com e sem o 9) antes de enviar.
    setTimeout(async () => {
        try {
            await sendWhatsappAlert("🚀 *SISTEMA JNC ONLINE*\nNotificações de OS ativadas.");
        } catch (err: any) {
            console.error('❌ Erro no envio inicial:', err?.message);
        }

        // Reprocessa alertas de caixa d'água que não foram entregues enquanto o Zap estava offline
        try {
            const { retryUndeliveredAlerts } = await import("./waterTankAlertService");
            await retryUndeliveredAlerts();
        } catch (err: any) {
            console.error('❌ Erro ao reprocessar alertas pendentes:', err?.message);
        }
    }, 8000);
});

// Evento: Comandos de Teste (Responde se você escrever 'status' ou '!teste')
client.on('message', async (msg) => {
    const texto = msg.body.toLowerCase();
    
    if (texto === 'status') {
        msg.reply('✅ O robô da JNC Soluteg está online e processando mensagens!');
        console.log('🤖 Resposta de status enviada.');
    }
    
    if (texto === '!teste') {
        msg.reply('Recebi seu teste! A integração está funcionando perfeitamente no servidor.');
        console.log('🤖 Resposta de teste enviada.');
    }
});

client.on('auth_failure', () => {
    isReady = false;
    console.error('❌ Falha na autenticação do Zap!');
});

client.on('disconnected', async (reason) => {
    isReady = false;
    console.log('⚠️ Zap desconectado! Motivo:', reason);
    console.log('🔄 Reconectando em 15 segundos...');
    setTimeout(async () => {
        try {
            await client.destroy();
        } catch (_) { /* ignora erro no destroy */ }
        setTimeout(() => {
            console.log('🔄 Reinicializando cliente WhatsApp...');
            client.initialize().catch((err) => {
                console.error('❌ Erro ao reinicializar WhatsApp:', err.message);
            });
        }, 3000);
    }, 15000);
});

// Inicia o serviço (desabilitado em dev via WHATSAPP_DISABLED=true no .env)
if (process.env.WHATSAPP_DISABLED !== 'true') {
  client.initialize().catch(handleInitError);
}

// Quando o PM2 reinicia o servidor mas o processo do Chromium sobrevive,
// o whatsapp-web.js falha ao tentar registrar funções que já existem na página
// ("already exists") OU com "The browser is already running" quando o destroy()
// não matou o processo Chrome a tempo. Ambos os casos: destrói e reinicializa.
async function handleInitError(err: any) {
  console.error('❌ Erro ao inicializar WhatsApp:', err?.message);
  const msg: string = err?.message ?? '';
  const isOldSession = msg.includes('already exists') || msg.includes('The browser is already running');
  if (isOldSession) {
    console.log('🔄 Sessão antiga do browser detectada. Destruindo e reinicializando...');
    try { await client.destroy(); } catch (_) {}
    await new Promise(r => setTimeout(r, 5000));
    client.initialize().catch((e: any) => {
      console.error('❌ Falha permanente na inicialização do WhatsApp:', e?.message);
    });
  }
}

// Detecta erros de conexão Puppeteer que ocorrem MID-OPERATION (o evento 'disconnected'
// não dispara nesses casos). Marca como desconectado e aciona reconexão manual.
// Frases conhecidas: 'detached Frame', 'Session closed', 'Target closed', 'Protocol error'
function isConnectionError(err: any): boolean {
  const msg: string = err?.message ?? '';
  return (
    msg.includes('detached Frame') ||
    msg.includes('Session closed') ||
    msg.includes('Target closed') ||
    msg.includes('Protocol error')
  );
}

let reconnecting = false; // evita múltiplas reconexões concorrentes

function triggerReconnect() {
  if (reconnecting) return;
  reconnecting = true;
  isReady = false;
  console.log('🔄 Erro de conexão Puppeteer detectado — reconectando WhatsApp em 15s...');
  setTimeout(async () => {
    try { await client.destroy(); } catch (_) {}
    setTimeout(() => {
      console.log('🔄 Reinicializando cliente WhatsApp após erro de frame...');
      reconnecting = false;
      // Usa handleInitError para tratar "browser already running" caso o
      // destroy() não tenha matado o Chrome a tempo
      client.initialize().catch(handleInitError);
    }, 3000);
  }, 15000);
}

/**
 * Retorna o status atual da conexão WhatsApp
 */
export const getWhatsappStatus = () => ({
    isReady,
    qrCodeDataUrl: lastQrDataUrl,
});

/**
 * Reconecta o cliente WhatsApp manualmente (útil pelo painel admin)
 */
export const reconnectWhatsapp = async () => {
    console.log('🔄 Reconexão manual solicitada via painel...');
    isReady = false;
    lastQrDataUrl = null;
    try {
        await client.destroy();
    } catch (_) { /* ignora */ }
    setTimeout(() => {
        console.log('🔄 Reinicializando cliente WhatsApp...');
        client.initialize().catch((err: any) => {
            console.error('❌ Erro ao reinicializar WhatsApp:', err.message);
        });
    }, 2000);
};

/**
 * Envia mensagem para um número específico (ex: cliente)
 */
export const sendWhatsappToNumber = async (phone: string, message: string) => {
    if (!isReady) {
        // Lança erro para que o chamador possa registrar a falha e acionar retry/fallback
        throw new Error("WhatsApp não está conectado");
    }

    // Normaliza o número: remove tudo que não é dígito, garante prefixo 55
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;

    try {
        const cusId = `${normalized}@c.us`;
        const check = await client.getNumberId(cusId);
        if (!check) {
            throw new Error(`Número ${normalized} não encontrado no WhatsApp`);
        }
        // getChatById falha com erro críptico "r" quando o contato migrou para @lid.
        // client.sendMessage resolve o ID internamente sem depender do getChatById.
        await client.sendMessage(cusId, message);
        console.log(`🚀 Mensagem enviada para ${normalized}`);
    } catch (err: any) {
        if (isConnectionError(err)) triggerReconnect();
        throw err;
    }
};

/**
 * Envia mensagem + PDF para um número específico (ex: cliente)
 */
export const sendWhatsappToNumberWithPDF = async (phone: string, message: string, pdfBuffer: Buffer, filename: string) => {
    if (!isReady) {
        console.error('❌ ERRO: Zap não está pronto para envio ao cliente.');
        return;
    }

    const digits = phone.replace(/\D/g, '');
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;

    try {
        const cusId = `${normalized}@c.us`;
        const check = await client.getNumberId(cusId);
        if (check) {
            const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);
            await client.sendMessage(cusId, media, { caption: message });
            console.log(`🚀 PDF enviado para ${normalized}`);
        } else {
            console.error(`❌ Número ${normalized} não encontrado no WhatsApp.`);
        }
    } catch (err: any) {
        console.error('❌ ERRO ao enviar PDF para número:', err?.message);
        if (isConnectionError(err)) triggerReconnect();
    }
};

/**
 * Função exportada para enviar alertas de OS do sistema
 */
export const sendWhatsappAlert = async (message: string) => {
    console.log(`--- GATILHO: Buscando identificador real para JNC ---`);
    
    if (!isReady) {
        console.error('❌ ERRO: Zap não está pronto.');
        return;
    }

    try {
        // Tentamos os dois formatos possíveis do litoral
        const formatos = ["5513981301010@c.us", "551381301010@c.us"];
        let idFinal: string | null = null;

        for (const f of formatos) {
            const check = await client.getNumberId(f);
            if (check) {
                // getNumberId pode retornar @lid (novo formato Meta) que quebra getChatById.
                // Se vier @lid, usa o @c.us que já passou na validação.
                idFinal = check._serialized.includes('@lid') ? f : check._serialized;
                break;
            }
        }

        if (idFinal) {
            console.log(`✅ ID Localizado: ${idFinal}`);
            await client.sendMessage(idFinal, message);
            console.log('🚀 SUCESSO: Mensagem enviada para a JNC!');
        } else {
            console.error('❌ ERRO: O WhatsApp não encontrou o número 13-98130-1010 em nenhum formato.');
        }
    } catch (err: any) {
        console.error('❌ ERRO CRÍTICO:', err?.message);
        if (isConnectionError(err)) triggerReconnect();
    }
};

/**
 * Envia alerta + PDF para o admin (JNC)
 */
export const sendWhatsappAlertWithPDF = async (message: string, pdfBuffer: Buffer, filename: string) => {
    if (!isReady) {
        console.error('❌ ERRO: Zap não está pronto.');
        return;
    }

    try {
        const formatos = ["5513981301010@c.us", "551381301010@c.us"];
        let idFinal: string | null = null;

        for (const f of formatos) {
            const check = await client.getNumberId(f);
            if (check) {
                idFinal = check._serialized.includes('@lid') ? f : check._serialized;
                break;
            }
        }

        if (idFinal) {
            const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);
            await client.sendMessage(idFinal, media, { caption: message });
            console.log('🚀 SUCESSO: PDF enviado para a JNC!');
        } else {
            console.error('❌ ERRO: O WhatsApp não encontrou o número 13-98130-1010 em nenhum formato.');
        }
    } catch (err: any) {
        console.error('❌ ERRO CRÍTICO ao enviar PDF para admin:', err?.message);
        if (isConnectionError(err)) triggerReconnect();
    }
};