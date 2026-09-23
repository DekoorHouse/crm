const { isDeliveryDispute, protectDeliveryIncident } = require('../server/deliveryIncidentGuard');
test.each(['Mi pedido no se me entregó', 'Se equivocaron de privada', 'En el privado no trabaja ningún Luis', 'No he recibido mi paquete', 'Aparece entregado pero no lo tengo'])('detects delivery dispute: %s', text => expect(isDeliveryDispute(text)).toBe(true));
test.each(['Gracias', '¿Cuándo envían mi pedido?', 'Quiero otra lámpara'])('does not invent an incident: %s', text => expect(isDeliveryDispute(text)).toBe(false));
const args = () => ({ contactRef: { update: jest.fn().mockResolvedValue() }, contact: {}, customerText: 'Se equivocaron de privada', reply: 'Fue nuestro error. Ya abrimos una aclaración con DHL. Mañana te reponemos el pedido.', timestamp: 'now' });
test('persists pending review and replaces unsupported admission and promises', async () => {
 const a=args(); const text=await protectDeliveryIncident(a);
 expect(a.contactRef.update).toHaveBeenCalledWith(expect.objectContaining({ deliveryIncidentPending: true }));
 expect(text).toContain('no hay una conclusión confirmada');
 expect(text).not.toMatch(/nuestro error|abrimos|reponemos/);
});
test('does not claim escalation if storage failed', async () => {
 const a=args(); a.contactRef.update.mockRejectedValue(new Error('offline'));
 await expect(protectDeliveryIncident(a)).rejects.toThrow('offline');
});
test('pending follow-up remains neutral without repeating acknowledgement', async () => {
 const a=args(); a.contact={ deliveryIncidentPending:true }; a.customerText='¿Cuánto tardan?';
 expect(await protectDeliveryIncident(a)).toContain('ni una fecha');
 a.customerText='Gracias'; expect(await protectDeliveryIncident(a)).toBe('Con gusto.');
});
test('unrelated and new purchase conversations retain normal responses', async () => {
 const a=args(); a.customerText='Quiero otra lámpara'; a.contact={deliveryIncidentPending:true}; a.newPurchase=true;
 expect(await protectDeliveryIncident(a)).toBe(a.reply);
 a.newPurchase=false; a.contact.activePurchaseSessionId='new';
 expect(await protectDeliveryIncident(a)).toBe(a.reply);
});
