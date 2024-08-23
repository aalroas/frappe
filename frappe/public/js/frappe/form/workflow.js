// Copyright (c) 2015, Frappe Technologies Pvt. Ltd. and Contributors
// MIT License. See license.txt

frappe.ui.form.States = class FormStates {
	constructor(opts) {
		$.extend(this, opts);
		this.state_fieldname = frappe.workflow.get_state_fieldname(this.frm.doctype);

		// no workflow?
		if (!this.state_fieldname) return;

		this.update_fields = frappe.workflow.get_update_fields(this.frm.doctype);

		var me = this;
		$(this.frm.wrapper).bind("render_complete", function () {
			me.refresh();
		});
	}

	setup_help() {
		var me = this;
		this.frm.page.add_action_item(
			__("Help"),
			function () {
				frappe.workflow.setup(me.frm.doctype);
				var state = me.get_state();
				var d = new frappe.ui.Dialog({
					title: "Workflow: " + frappe.workflow.workflows[me.frm.doctype].name,
				});

				frappe.workflow.get_transitions(me.frm.doc).then((transitions) => {
					const next_actions =
						$.map(
							transitions,
							(d) => `${d.action.bold()} ${__("by Role")} ${d.allowed}`
						).join(", ") || __("None: End of Workflow").bold();

					const document_editable_by = frappe.workflow
						.get_document_state_roles(me.frm.doctype, state)
						.map((role) => role.bold())
						.join(", ");

					$(d.body)
						.html(
							`
					<p>${__("Current status")}: ${state.bold()}</p>
					<p>${__("Document is only editable by users with role")}: ${document_editable_by}</p>
					<p>${__("Next actions")}: ${next_actions}</p>
					<p>${__("{0}: Other permission rules may also apply", [__("Note").bold()])}</p>
				`
						)
						.css({ padding: "15px" });

					d.show();
				});
			},
			true
		);
	}

	refresh() {
		// hide if its not yet saved
		if (this.frm.doc.__islocal) {
			this.set_default_state();
			return;
		}

		// state text
		const state = this.get_state();

		if (state) {
			// show actions from that state
			this.show_actions(state);
		}
	}

	show_actions() {
		var added = false;
		var me = this;

		// if the loaded doc is dirty, don't show workflow buttons
		if (this.frm.doc.__unsaved === 1) {
			return;
		}

		function has_approval_access(transition) {
			let approval_access = false;
			const user = frappe.session.user;
			if (
				user === "Administrator" ||
				transition.allow_self_approval ||
				user !== me.frm.doc.owner
			) {
				approval_access = true;
			}
			return approval_access;
		}

		frappe.workflow.get_transitions(this.frm.doc).then((transitions) => {
			this.frm.page.clear_actions_menu();
			transitions.forEach((d) => {
				if (frappe.user_roles.includes(d.allowed) && has_approval_access(d)) {
					added = true;
					me.frm.page.add_action_item(__(d.action), function () {
						// set the workflow_action for use in form scripts
						frappe.dom.freeze();
						me.frm.selected_workflow_action = d.action;
						me.frm.script_manager.trigger("before_workflow_action").then(() => {
							if (d.action == "Cancel") {
								frappe.dom.unfreeze();
								frappe.confirm(
									__(
										"Are you sure you want to Cancel document?",
										"Attention!"
									),
									() => {
										frappe.dom.freeze();
										frappe
											.xcall("frappe.model.workflow.apply_workflow", {
												doc: me.frm.doc,
												action: d.action,
											})
											.then((doc) => {
												frappe.model.sync(doc);
												me.frm.refresh();
												me.frm.selected_workflow_action = null;
												me.frm.script_manager.trigger("after_workflow_action");
											})
											.finally(() => {
												frappe.dom.unfreeze();
											});
									}
								);
							} else if (me.frm.doc.doctype == "Sample Items") {
								frappe.dom.unfreeze();
								const dialog = new frappe.ui.Dialog({
									title: __("Comment"),
									fields: [
									  {
										fieldtype: "Text",
										fieldname: "comment",
										label: __("Comment"),
										reqd: 1,
									  },
									],
									primary_action_label: __("Submit"),
									primary_action: function () {
										const values = dialog.get_values();
										if (!values) {
										  return;
										}
										frappe.call({
											method: "frappe.desk.form.utils.add_comment",
											args: {
												reference_doctype: "Item",
												reference_name: me.frm.doc.name,
												content: __(dialog.get_value("comment")),
												comment_email: frappe.session.user,
												comment_by: frappe.session.user_fullname
											},
										});
										frappe.call({
											method: "frappe.desk.form.utils.add_comment",
											args: {
												reference_doctype: "Sample Items",
												reference_name: me.frm.doc.name,
												content: __(dialog.get_value("comment")),
												comment_email: frappe.session.user,
												comment_by: frappe.session.user_fullname
											},
										});
										frappe
										.xcall("frappe.model.workflow.apply_workflow", {
											doc: me.frm.doc,
											action: d.action,
										})
										.then((doc) => {
											frappe.model.sync(doc);
											me.frm.refresh();
											me.frm.selected_workflow_action = null;
											me.frm.script_manager.trigger("after_workflow_action");
										})
										.finally(() => {
											frappe.dom.unfreeze();
										});
										dialog.hide();
									  },
									})
								dialog.show();
							} else {
								frappe
								.xcall("frappe.model.workflow.apply_workflow", {
									doc: me.frm.doc,
									action: d.action,
								})
								.then((doc) => {
									frappe.model.sync(doc);
									me.frm.refresh();
									me.frm.selected_workflow_action = null;
									me.frm.script_manager.trigger("after_workflow_action");
								})
								.finally(() => {
									frappe.dom.unfreeze();
								});
							}
						});
					});
				}
			});

			this.setup_btn(added);
		});
	}

	setup_btn(action_added) {
		if (action_added) {
			this.frm.page.btn_primary.addClass("hide");
			this.frm.page.btn_secondary.addClass("hide");
			this.frm.toolbar.current_status = "";
			this.setup_help();
		}
	}

	set_default_state() {
		var default_state = frappe.workflow.get_default_state(
			this.frm.doctype,
			this.frm.doc.docstatus
		);
		if (default_state) {
			this.frm.set_value(this.state_fieldname, default_state);
		}
	}

	get_state() {
		if (!this.frm.doc[this.state_fieldname]) {
			this.set_default_state();
		}
		return this.frm.doc[this.state_fieldname];
	}
};
