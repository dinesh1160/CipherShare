import _sodium from 'libsodium-wrappers';


export async function test() {
    
    await _sodium.ready;
    const sodium = _sodium;

    const keypair = sodium.crypto_box_keypair();

    console.log('pvt: ', sodium.to_hex(keypair.privateKey));
    console.log('pub: ' ,sodium.to_hex(keypair.publicKey));

    return true;

}