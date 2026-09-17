// Una confirmación sólo puede salir después de terminar el registro, incluso si viene de un atajo.
const registrationClaim = text => /ya\s+registramos\s+tu\s+pedido|(?:pedido|orden)\s+(?:DH\d+\s+)?(?:ya\s+)?(?:qued[oó]|est[aá]|ha sido)\s+(?:ya\s+)?registrad[oa]/i.test(String(text || '').replace(/[*_]/g, ''));
const REGISTRATION_PENDING = 'El registro de tu pedido necesita revisión del equipo. Una persona revisará los datos y te ayudará a continuar.';

function createRegistrationTurn(register) {
    let pending = null, attempted = false, orderNumber = null;
    return {
        get attempted() { return attempted; },
        get orderNumber() { return orderNumber; },
        ensure(extraText = '') {
            if (!pending) {
                attempted = true;
                pending = Promise.resolve().then(() => register(extraText)).then(result => (orderNumber = result || null));
            }
            return pending;
        },
    };
}

module.exports = { createRegistrationTurn, registrationClaim, REGISTRATION_PENDING };
