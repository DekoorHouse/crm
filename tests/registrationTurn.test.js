const { createRegistrationTurn, registrationClaim, REGISTRATION_PENDING } = require('../server/orders/registrationTurn');

test('el turno espera la escritura y reutiliza el resultado para el atajo y el pago', async () => {
    let finish;
    const register = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const gate = createRegistrationTurn(register);
    let confirmed = false;
    const pending = gate.ensure('Ya registramos tu pedido').then(result => { confirmed = !!result; });
    await Promise.resolve();
    const duplicate = gate.ensure('/confirmar');
    expect(confirmed).toBe(false);
    expect(register).toHaveBeenCalledTimes(1);
    finish('DH19000');
    await pending;
    expect(await duplicate).toBe('DH19000');
    expect(confirmed).toBe(true);
});

test('un fallo no devuelve confirmación ni inicia otro registro en el mismo turno', async () => {
    const register = jest.fn().mockResolvedValue(null);
    const gate = createRegistrationTurn(register);
    expect(await gate.ensure()).toBeNull();
    expect(await gate.ensure()).toBeNull();
    expect(register).toHaveBeenCalledTimes(1);
    expect(registrationClaim(REGISTRATION_PENDING)).toBe(false);
});

test.each(['**Ya registramos tu pedido y está en fabricación.**', 'Tu pedido quedó registrado.', 'Tu orden ha sido registrada.'])('reconoce confirmaciones en texto o atajos expandidos: %s', text => {
    expect(registrationClaim(text)).toBe(true);
});

test('una negación no dispara el registro', () => {
    expect(registrationClaim('Tu pedido no quedó registrado.')).toBe(false);
});
