import "dotenv/config";
import { join } from 'path'
import fs from 'fs'
import {
  createBot,
  createProvider,
  createFlow,
  addKeyword,
  EVENTS,
} from "@builderbot/bot";
import { MemoryDB as Database } from "@builderbot/bot";
import { BaileysProvider as Provider } from "@builderbot/provider-baileys";
import { toAsk, httpInject, } from "@builderbot-plugins/openai-assistants";
import { typing } from "./utils/presence";
import { configDotenv } from "dotenv";
import OpenAI from "openai";
import { cripto } from "cripto";
configDotenv()

const PORT = process.env?.PORT ?? 3008;
const ASSISTANT_ID = process.env?.ASSISTANT_ID ?? "";

/* const updateAssistants = async (assistantId, vectorDb) => {
    await openai.beta.assistants.update(assistantId, {
        tool_resources: { file_search: { vector_store_ids: [vectorDb.vector_store_id] } },
    });
};
const uploadFile = async (pathFiles) => {
    const fileStreams = pathFiles.map((path) => require$$1$1.createReadStream(path));
    const vectorStore = await openai.beta.vectorStores.create({
        name: `file-${randomUUID()}`,
    });
    const ids = await openai.beta.vectorStores.fileBatches.uploadAndPoll(vectorStore.id, { files: fileStreams });
    return ids;
};

const MhttpInject = (providerServer) => {
    providerServer.get('/v1/form', async (_, res) => {
        fs.readFile( join(__dirname, 'public', 'form.html'), (err, data) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error interno del servidor');
            }
            else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(data);
            }
        });
    });
    providerServer
        .use(upload.array('file', 5))
        .post('/v1/upload', async (req, res) => {
        const reqParse = req;
        const files = (reqParse?.files ?? []);
        const filesPath = files.map((f) => f.path);
        const idsFiles = await uploadFile(filesPath);
        await updateAssistants(ASSISTANT_ID, idsFiles);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
    });
}; */

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


const retrieveAssistants = async (id) => {
    const assistant = await openai.beta.assistants.retrieve(id);
    return assistant;
};
const createThread = async () => {
    const thread = await openai.beta.threads.create();
    return thread;
};

const addMessage = async (threadId, content) => {
    const message = await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content
    });
    return message;
};

const run = async (threadId: string, assistant): Promise<string> => {
    return new Promise((resolve) => {
        let response = '';
        const run = openai.beta.threads.runs.stream(threadId, {
            assistant_id: assistant.id
        })
            .on('textDelta', async (textDelta, snapshot) => {
            response += textDelta.value;
        })
            .on('toolCallCreated', (toolCall) => {
            console.log({ toolCall });
        })
            .on("messageDone", async (event) => {
            resolve(response);
        });
        return run;
    });
    // We use the stream SDK helper to create a run with
    // streaming. The SDK provides helpful event listeners to handle 
    // the streamed response.
};

const   MtoAsk = async (assistantId: string, message: string, state): Promise<string> => {
    let thread = state.get('thread') ?? null;
    const assistants = await retrieveAssistants(assistantId);
    if (!thread) {
        const threadObject = await createThread();
        thread = threadObject.id;
        await state.update({ thread });
    }
    await addMessage(thread, message);
    const response = await run(thread, assistants);
    console.log(response);
    return response;
};

const welcomeFlow = addKeyword<Provider, Database>(EVENTS.WELCOME).addAction(
  async (ctx, { flowDynamic, state, provider }) => {
    await typing(ctx, provider);
    const response = await MtoAsk(ASSISTANT_ID, ctx.body, state);
    const chunks = response.split(/\n\n+/);
    for (const chunk of chunks) {
      await flowDynamic([{ body: chunk.trim() }]);
    }
  }
);
const main = async () => {
    const adapterFlow = createFlow([welcomeFlow])
    
    const adapterProvider = createProvider(Provider)
    const adapterDB = new Database()

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('REGISTER_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('SAMPLES', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    httpInject(adapterProvider.server);
    httpServer(+PORT)
}

main()
