import * as alephium from "alephium-js"

async function test() {
    const client = new alephium.CliqueClient({baseUrl: "http://127.0.0.1:12973"})
    await client.init(false)
    const nodes = await client.clique.nodes
    console.log(nodes)
}

test()