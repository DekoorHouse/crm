// ... existing code ...
 * @param {boolean} isClickable - Si la tarjeta debe tener la clase 'clickable'.
 * @returns {HTMLElement} El elemento de la tarjeta creado.
 */
export function createSummaryCard(title, amount, isClickable) {
// ... existing code ...
      card.innerHTML = `
        <div class="icon-container"><i class="${icons[title] || 'fas fa-tag'}"></i></div>
        <div> <div class="summary-card-title">${displayTitle}</div> <div class="summary-card-value">${formatCurrency(amount)}</div> </div>`;
      return card;
}
  
/**
// ... existing code ...
 * Muestra u oculta el modal principal, configurando su contenido y acciones.
 * @param {object} options - Las opciones para configurar el modal.
 */
export function showModal({ show = true, title, body, onConfirm, onModalOpen, confirmText = 'Confirmar', confirmClass = '', showCancel = true, showConfirm = true }) {
      const modalContent = elements.modal.querySelector('.modal-content');
      if (modalContent) {
          modalContent.classList.remove('modal-lg');
      }

      if (!show) { elements.modal.classList.remove('visible'); return; }
      elements.modalTitle.textContent = title;
      elements.modalBody.innerHTML = body;
// ... existing code ...
      elements.modalCancelBtn.onclick = () => showModal({ show: false });
      elements.modal.classList.add('visible');
      if (onModalOpen) onModalOpen();
}

/**
 * Muestra un modal para que el usuario seleccione qué registros duplicados desea cargar.
 * @param {Array<object>} duplicateGroups - Grupos de gastos duplicados encontrados.
 * @param {Array<object>} nonDuplicates - Gastos únicos que se cargarán automáticamente.
 */
export function showDuplicateSelectionModal(duplicateGroups, nonDuplicates) {
    let tableRowsHtml = '';
    let groupIndex = 0;
    for (const group of duplicateGroups) {
        tableRowsHtml += `<tr class="group-header"><td colspan="5"><strong>${group.reason}</strong> (${group.expenses.length} registros)</td></tr>`;
        
        let expenseIndex = 0;
        for (const expense of group.expenses) {
            tableRowsHtml += `
                <tr data-group-index="${groupIndex}" data-expense-index="${expenseIndex}">
                    <td><input type="checkbox" class="duplicate-checkbox" checked></td>
                    <td>${expense.date}</td>
                    <td>${expense.concept}</td>
                    <td>${expense.charge > 0 ? formatCurrency(expense.charge) : ''}</td>
                    <td>${expense.credit > 0 ? formatCurrency(expense.credit) : ''}</td>
                </tr>
            `;
            expenseIndex++;
        }
        groupIndex++;
    }

    const modalBody = `
        <p>Se encontraron ${duplicateGroups.reduce((acc, g) => acc + g.expenses.length, 0)} registros que podrían ser duplicados. Se cargarán <strong>${nonDuplicates.length}</strong> registros únicos automáticamente.</p>
        <p>Por favor, selecciona los registros de la lista que también deseas cargar.</p>
        <div class="table-container" style="max-height: 45vh; margin-top: 15px;">
            <table class="table duplicate-table">
                <thead>
                    <tr>
                        <th><input type="checkbox" id="select-all-duplicates" checked title="Seleccionar/Deseleccionar Todos"></th>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th>Cargo</th>
                        <th>Ingreso</th>
                    </tr>
                </thead>
                <tbody>${tableRowsHtml}</tbody>
            </table>
        </div>
    `;

    showModal({
        title: 'Gestión de Duplicados al Cargar',
        body: modalBody,
        confirmText: 'Cargar Seleccionados',
        onConfirm: async () => {
            const selectedDuplicates = [];
            const checkboxes = document.querySelectorAll('.duplicate-checkbox:checked');
            
            checkboxes.forEach(cb => {
                const row = cb.closest('tr');
                if (row && row.dataset.groupIndex) { // Asegurarse de no tomar el checkbox del header
                    const groupIdx = parseInt(row.dataset.groupIndex, 10);
                    const expenseIdx = parseInt(row.dataset.expenseIndex, 10);
                    if (!isNaN(groupIdx) && !isNaN(expenseIdx)) {
                        selectedDuplicates.push(duplicateGroups[groupIdx].expenses[expenseIdx]);
                    }
                }
            });

            const expensesToSave = [...nonDuplicates, ...selectedDuplicates];

            if (expensesToSave.length > 0) {
                try {
                    await services.saveBulkExpenses(expensesToSave);
                    showModal({
                        title: 'Éxito',
                        body: `Se han cargado <strong>${expensesToSave.length}</strong> registros en total. (${nonDuplicates.length} únicos y ${selectedDuplicates.length} duplicados seleccionados).`,
                        confirmText: 'Entendido',
                        showCancel: false
                    });
                } catch (error) {
                     showModal({
                        title: 'Error al Guardar',
                        body: `No se pudieron guardar los registros. Error: ${error.message}`,
                        confirmText: 'Cerrar',
                        showCancel: false
                    });
                }
            } else {
                 showModal({
                    title: 'Sin Cambios',
                    body: 'No se seleccionó ningún registro para cargar.',
                    confirmText: 'Entendido',
                    showCancel: false
                });
            }
        },
        onModalOpen: () => {
            const selectAllCheckbox = document.getElementById('select-all-duplicates');
            if (selectAllCheckbox) {
                selectAllCheckbox.addEventListener('change', (e) => {
                    document.querySelectorAll('.duplicate-checkbox').forEach(cb => {
                        cb.checked = e.target.checked;
                    });
                });
            }
            // Add this to make the modal larger
            elements.modal.querySelector('.modal-content').classList.add('modal-lg');
        }
    });
}
  
/**
 * Abre el modal para agregar o editar un movimiento operativo.
// ... existing code ...
