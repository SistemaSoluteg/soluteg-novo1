import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, MessageMedia } = pkg as any;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';

const WHATSAPP_DISABLED = process.env.WHATSAPP_DISABLED === "true";
if (WHATSAPP_DISABLED) {
    console.log("[WhatsApp] WHATSAPP_DISABLED=true — serviço desabilitado");
}

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
const meuNumero = "551381301010@c.us"; // Formato ID para o litoral (13)

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

    // Aguarda 8s para garantir que o client está estável antes de enviar
    setTimeout(async () => {
        try {
            console.log('--- Tentando enviar mensagem inicial para:', meuNumero);
            await client.sendMessage(meuNumero, "🚀 *SISTEMA JNC ONLINE*\nNotificações de OS ativadas.");
            console.log('🚀 Mensagem de inicialização ENVIADA!');
        } catch (err) {
            console.error('❌ Erro no envio inicial:', err.message);
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

// Inicia o serviço
if (!WHATSAPP_DISABLED) {
    client.initialize();
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
    if (WHATSAPP_DISABLED) {
        console.log("[WhatsApp] Envio ignorado (WHATSAPP_DISABLED=true)");
        return;
    }
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
    if (WHATSAPP_DISABLED) {
        console.log("[WhatsApp] Envio ignorado (WHATSAPP_DISABLED=true)");
        return;
    }
    if (!isReady) {
        // Lança erro para que o chamador possa registrar a falha e acionar retry/fallback
        throw new Error("WhatsApp não está conectado");
    }

    // Normaliza o número: remove tudo que não é dígito, garante prefixo 55
    const digits = phone.replace(/\D/g, '');
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;

    try {
        const check = await client.getNumberId(`${normalized}@c.us`);
        if (check) {
            const chat = await client.getChatById(check._serialized);
            await chat.sendMessage(message);
            console.log(`🚀 Mensagem enviada para ${normalized}`);
        } else {
            console.error(`❌ Número ${normalized} não encontrado no WhatsApp.`);
        }
    } catch (err: any) {
        console.error('❌ ERRO ao enviar para número:', err?.message);
    }
};

/**
 * Envia mensagem + PDF para um número específico (ex: cliente)
 */
export const sendWhatsappToNumberWithPDF = async (phone: string, message: string, pdfBuffer: Buffer, filename: string) => {
    if (WHATSAPP_DISABLED) {
        console.log("[WhatsApp] Envio ignorado (WHATSAPP_DISABLED=true)");
        return;
    }
    if (!isReady) {
        console.error('❌ ERRO: Zap não está pronto para envio ao cliente.');
        return;
    }

    const digits = phone.replace(/\D/g, '');
    const normalized = digits.startsWith('55') ? digits : `55${digits}`;

    try {
        const check = await client.getNumberId(`${normalized}@c.us`);
        if (check) {
            const chat = await client.getChatById(check._serialized);
            const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);
            await chat.sendMessage(media, { caption: message });
            console.log(`🚀 PDF enviado para ${normalized}`);
        } else {
            console.error(`❌ Número ${normalized} não encontrado no WhatsApp.`);
        }
    } catch (err: any) {
        console.error('❌ ERRO ao enviar PDF para número:', err?.message);
    }
};

/**
 * Função exportada para enviar alertas de OS do sistema
 */
export const sendWhatsappAlert = async (message: string) => {
    if (WHATSAPP_DISABLED) {
        console.log("[WhatsApp] Envio ignorado (WHATSAPP_DISABLED=true)");
        return;
    }
    console.log(`--- GATILHO: Buscando identificador real para JNC ---`);
    
    if (!isReady) {
        console.error('❌ ERRO: Zap não está pronto.');
        return;
    }

    try {
        // Tentamos os dois formatos possíveis do litoral
        const formatos = ["5513981301010@c.us", "551381301010@c.us"];
        let idFinal = null;

        for (const f of formatos) {
            const check = await client.getNumberId(f);
            if (check) {
                idFinal = check._serialized;
                break;
            }
        }

        if (idFinal) {
            console.log(`✅ ID Localizado: ${idFinal}`);
            // Usamos o objeto 'chat' para garantir a entrega
            const chat = await client.getChatById(idFinal);
            await chat.sendMessage(message);
            console.log('🚀 SUCESSO: Mensagem enviada para a JNC!');
        } else {
            console.error('❌ ERRO: O WhatsApp não encontrou o número 13-98130-1010 em nenhum formato.');
        }
    } catch (err) {
        console.error('❌ ERRO CRÍTICO:', err.message);
    }
};

/**
 * Envia alerta + PDF para o admin (JNC)
 */
export const sendWhatsappAlertWithPDF = async (message: string, pdfBuffer: Buffer, filename: string) => {
    if (WHATSAPP_DISABLED) {
        console.log("[WhatsApp] Envio ignorado (WHATSAPP_DISABLED=true)");
        return;
    }
    if (!isReady) {
        console.error('❌ ERRO: Zap não está pronto.');
        return;
    }

    try {
        const formatos = ["5513981301010@c.us", "551381301010@c.us"];
        let idFinal = null;

        for (const f of formatos) {
            const check = await client.getNumberId(f);
            if (check) {
                idFinal = check._serialized;
                break;
            }
        }

        if (idFinal) {
            const chat = await client.getChatById(idFinal);
            const media = new MessageMedia('application/pdf', pdfBuffer.toString('base64'), filename);
            await chat.sendMessage(media, { caption: message });
            console.log('🚀 SUCESSO: PDF enviado para a JNC!');
        } else {
            console.error('❌ ERRO: O WhatsApp não encontrou o número 13-98130-1010 em nenhum formato.');
        }
    } catch (err: any) {
        console.error('❌ ERRO CRÍTICO ao enviar PDF para admin:', err?.message);
    }
};