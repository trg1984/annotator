// TODO
//  maybe allow also free-hand drawing with some special key, but not as default
//      ( store as series of points)
// resize handling...
//  try scaling? does not always make that much sense
//  maybe allow some kind of default behaviors (clear, fixed/locked, try-scale (scale positions, not
//      font or note-graphics) 
//  also handle events that change the position of the element (easy if the size does not change)

// ensure that $ and undefined are what is expected inside 
// the closure
(function($, undefined) {

$.widget( "rolind.annotator", {

    // relevant draw-functions can be overridden to use 
    // different stylings etc.
    options: {
        drawers: {
            line: $.noop,
            hilight: $.noop,
            text: $.noop
        },
        noteHandlerFactory: $.noop,
        noteIconUrl: "http://upload.wikimedia.org/wikipedia/commons/c/cc/Note.png"
    },

    _create: function() {
        this.annot = {
            // upper-left corner of the canvas and annotated element
            left: 0,
            top: 0,
            // coordinates of where mouse-down last happened
            dx: 0,
	        dy: 0,
            // coordinates of where mouse-up last happened
            ux: 0,
	        uy: 0,
            // coordinates of 'current' mouse position
	        mx: 0,
	        my: 0,
            // keep count of whether left or right -button is pressed down
	        lDown: false,
	        rDown: false,
            // keep count of current mode (change by doubleclick)
            mode: 0,
            // buffer the currently text under-writing
            txtBuffer: "",
            // whether to interpret key-presses as writing
            writeOn: false,
            // whether to catch key-commands
            catchCmds: false,
            // actually accepted annotation-drawings
            drawings: {},
            // annotation notes
            notes: {},
            // running-id for events for easy access later
            runningId: 0,
            // main canvas context
            mainCtx: null,
            // preview canvas context
            preCtx: null,
            // history of most recent events to allow ctrl+z
            events: [],
            // note-icon
            noteIcon: {},
            noteIconWidth: 16,
            noteIconHeight: 16,
            // look-up map for pixels taken by notes
            noteLookup: {},
            noteHandler: {}
        };
        // catch the upper-left corner, initiate needed canvases, pre-load
        // note-icon, instantiate note-handler, bind-listeners
        this.annot.left = this.element.position().left;
        this.annot.top = this.element.position().top;
        this.annot.mainCtx = this._createCanvas();
        this.annot.preCtx = this._createCanvas();
        this.annot.noteIcon = new Image();
        var that = this;
        this.annot.noteIcon.onload = function() {
            that.annot.noteIconWidth = that.annot.noteIcon.width;
            that.annot.noteIconHeight = that.annot.noteIcon.height;
        };
        this.annot.noteIcon.src = this.options.noteIconUrl;
        $.extend(this.options, $.rolind.annotator.defHandlers, this.options);
        this.annot.noteHandler = this.options.noteHandlerFactory();
        this._bindListeners();
    },

    // creates a canvas over this.element and returns its context
    _createCanvas: function() {
        var canv = $('<canvas/>').css({
            "position": "absolute",
            "left": this.annot.left,
            "top": this.annot.top,
            "cursor": "crosshair"
        }).appendTo(this.element);
        var ctx = canv[0].getContext('2d');
        ctx.canvas.height = this.element.height();
        ctx.canvas.width = this.element.width();
        return ctx;
    },

    _bindListeners: function() {
        var that = this;
        this.element.bind('dblclick',  function(event) {
		    if (event.buttons == 1) {
			    that.annot.mode = (that.annot.mode + 1) % 2;
		    }
	    });
	    this.element.bind('mousedown', function (event) {

            that.annot.dx = event.pageX - that.annot.left;
		    that.annot.dy = event.pageY - that.annot.top;

		    that.annot.mx = event.pageX - that.annot.left;
		    that.annot.my = event.pageY - that.annot.top;

            // click with ctrl pressed is 'note'-click
            if ( event.ctrlKey ) {
                that._handleNoteClick(event.shiftKey);
            } else {
		        that.annot.lDown = event.buttons == 1;
                that.annot.writeOn = true;
            }
	    });
	    this.element.bind('mousemove', function (event) {
		    if ( that.annot.txtBuffer !== "" ) {
                that._handleEvent('text', [that.annot.dx, that.annot.dy,
                        that.annot.txtBuffer]);
                that.annot.txtBuffer = "";
            }

		    that.annot.mx = event.pageX - that.annot.left;
		    that.annot.my = event.pageY - that.annot.top;

		    if (that.annot.lDown) {
                that._preview(that.annot.mode === 1 ? 'line' : 'hilight',
                    [that.annot.dx, that.annot.dy, that.annot.mx,
                    that.annot.my]);
            }
	    });
	    this.element.bind('mouseup', function (event) {

		    that.annot.mx = event.pageX - that.annot.left;
		    that.annot.my = event.pageY - that.annot.top;

		    that.annot.ux = event.pageX - that.annot.left;
		    that.annot.uy = event.pageY - that.annot.top;
		    that.annot.txtBuffer = "";
		    if (that.annot.lDown) {
                that._handleEvent(that.annot.mode === 1 ? 'line' : 'hilight',
                    [that.annot.dx, that.annot.dy, that.annot.mx,
                    that.annot.my]);
            }
		    that.annot.lDown = false;//(event.buttons == 1);
	    });
        this.element.bind('mouseenter', function(event) {
            that.annot.catchCmds = true;
        });
        this.element.bind('mouseleave', function(event) {
            that.annot.writeOn = false;
            that.annot.catchCmds = false;
            that.annot.lDown = false;
            that._clearCanvas(that.annot.preCtx);
        });
        $(document).on('keypress', function(event) {
            if ( that.annot.catchCmds ) {
                event = event || window.event;
                var charCode = event.which || event.keyCode;
                if (charCode == 122 && event.ctrlKey) {
                    that._tryUndo();
                    event.preventDefault();
                } else if ( that.annot.writeOn ) {
                    var typedChar = String.fromCharCode(charCode);
                    that.annot.txtBuffer += typedChar;
                    that._preview('text', [that.annot.dx, that.annot.dy,
                        that.annot.txtBuffer]);
                    event.preventDefault();
                }
            }
        });
    },
    
    // find if there is a note on this coordinate
    _lookupNotes: function(x, y) {
        if ( this.annot.noteLookup[x] ) {
            return this.annot.noteLookup[x][y];
        } else { return undefined; }
    },

    // adds a new note to this coordinate
    _addNewNote: function(x,y) {
        var id = this._nextId();
        this._drawNote(this.annot.dx, this.annot.dy);
        this._addNoteLu(id, x, y);
        this.annot.notes[id] = { noteX: x, noteY: y, data: {} };
        return id;
    },

    // adds this notes coordinates to lookup-table
    _addNoteLu: function(id, x, y) {
        var noteLu = this.annot.noteLookup;
        for ( var i = 0, maxI = this.annot.noteIconWidth; i < maxI; i++ ) {
            // initiate x if there is nothing with same x-coordinates
            if ( noteLu[x + i] === undefined ) { noteLu[x + i] = {} };
            for ( var j = 0, maxJ = this.annot.noteIconHeight; j < maxJ; j++) {
                noteLu[x + i][y + j] = id;
            }
        }
    },

    // deletes note and cleans it up from look-up table
    _deleteNote: function(noteId) {
        var noteObj = this.annot.notes[noteId], noteLu = this.annot.noteLookup;
        this.annot.noteHandler.deleteNote(noteId);
        delete this.annot.notes[noteId];
        for ( var i = 0, maxI = this.annot.noteIconWidth; i < maxI; i++ ) {
            // this can leak a little memory (ie. not delete some unnecessary x-columns)
            for ( var j = 0, maxJ = this.annot.noteIconHeight; j < maxJ; j++) {
                delete noteLu[noteObj.noteX + i][noteObj.noteY + j];
            }
        }
    },

    // 
    _handleNoteClick: function(askingDel) {
        var x = this.annot.dx, y = this.annot.dy,
            idToShow = this._lookupNotes(x,y);
        if ( idToShow === undefined ) {
            if ( ! askingDel ) {
                idToShow = this._addNewNote(x,y);
            }
        }
        if ( askingDel ) {
            if ( idToShow !== undefined ) {
                this._deleteNote(idToShow);
                this._redrawState();
            }
        } else {
            this.annot.noteHandler.showNote(idToShow);
        }
    },

    // draws note icon to given coordinates
    _drawNote: function(x, y) {
        this.annot.mainCtx.drawImage(this.annot.noteIcon, x, y);
    },

    // returns the current state as JSON-string
    saveState: function() {
        var that = this;
        // aske note-handler to save its state
        // and add the data returned from it to notes
        $.each(this.annot.notes, function(key, value) {
            var data = that.annot.noteHandler.saveNote(key);
            that.annot.notes[key].data = data;
        });
        var state = {
            drawings: this.annot.drawings,
            notes: this.annot.notes
        };
        return JSON.stringify(state);
    },

    // makes this annotator match given JSON-string
    loadState: function(jsonStr) {
        var newState = JSON.parse(jsonStr), that = this;
        this.clearAnnotations();
        this.annot.drawings = newState.drawings;
        this.annot.notes = newState.notes;
        // load all notes
        $.each(this.annot.notes, function(key, value) {
            that.annot.noteHandler.loadNote(key, value.data);
            that._addNoteLu(key, value.noteX, value.noteY);
        });
        this._redrawState();
    },

    // clears all the annotations
    clearAnnotations: function() {
        var that = this;
        this.annot.events = [];
        this.annot.drawings = {};
        this._clearCanvas(this.annot.mainCtx);
        this._clearCanvas(this.annot.preCtx);
        // first asked all notes to be deleted from external system
        $.each(this.annot.notes, function(key, value) {
            that.annot.noteHandler.deleteNote(key);
        });
        this.annot.notes = {};
    },

    // checks if there is something to undo in the 
    // history, and undos if possible
    _tryUndo: function() {
       var toUndo = this.annot.events.pop();
       if ( toUndo !== undefined ) {
           // only drawings can be undone using this method 
           // notes can be deleted and edited directly
           delete this.annot.drawings[toUndo];
       }
       this._redrawState();
    },

    // clear given canvas
    _clearCanvas: function(ctx) {
        ctx.clearRect(0,0, ctx.canvas.width, ctx.canvas.height);
    },

    _nextId: function() {
        var res = this.annot.runningId;
        this.annot.runningId += 1;
        return res;
    },

    // handles an actual drawing event
    _handleEvent: function(drawer, args) {
        // some care must be taken to store this really as an array...
        var id = this._nextId();
        this.annot.drawings[id] = { type: drawer, args: args};
        this.annot.events.push(id);
        this._clearCanvas(this.annot.preCtx);
        this._drawEvent(this.annot.mainCtx, drawer, args);
    },

    // previews currently active drawing
    _preview: function(drawer, args) {
        this._clearCanvas(this.annot.preCtx);
        this._drawEvent(this.annot.preCtx, drawer, args);
    },

    // clear and then redraw everything saved to its state
    _redrawState: function() {
        var that = this;
        this._clearCanvas(this.annot.mainCtx);
        $.each(this.annot.drawings, function(key, value) {
            that._drawEvent(that.annot.mainCtx, value.type, value.args);
        });
        $.each(this.annot.notes, function(key, value) {
            that._drawNote(value.noteX, value.noteY);
        });
    },

    // draws given drawing event to given canvas
    _drawEvent: function(ctx, drawerName, args) {
        var drawer = this.options.drawers[drawerName];
        if ( drawer ) {
            var drawerArgs = Array.prototype.slice.call(args, 0);
            drawerArgs.unshift(ctx);
            drawer.apply(this, drawerArgs);
        }
    },

    destroy: function() {
        this.element.remove(this.annot.mainCtx.canvas);
        this.element.remove(this.annot.preCtx.canvas);        
        // Call the base destroy function.
        $.Widget.prototype.destroy.call( this );
    }

});

// add some default implementations to callback-functions
$.extend($.rolind.annotator, {
    defHandlers: {
        drawers: {
            line: function(ctx, x0, y0, x1, y1) {
                ctx.beginPath();
                ctx.lineWidth = 3;
                ctx.strokeStyle = 'rgba(0, 0, 128, 0.95)';
                ctx.lineCap = 'round';
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.stroke();
            },
            hilight: function(ctx, x0, y0, x1, y1) {
                ctx.beginPath();
                ctx.lineWidth = 15;
                ctx.strokeStyle = 'rgba(255, 0, 255, 0.15)';
                ctx.lineCap = 'square';
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1, y1);
                ctx.stroke();
            },
            text: function(ctx, x, y, text) {
                ctx.fillStyle = "black";
                ctx.font = "bold 16px Arial";
                ctx.fillText(text, x, y);
            }
        },
        noteHandlerFactory: function() {
            var _notes = {}, noteDial = $("<div title='Edit note'></div>"),
                noteTa = $("<textarea/>").appendTo(noteDial),
                _showNote = function(noteId) {
                    if ( ! _notes[noteId] ) {
                        _notes[noteId] = "";
                    }
                    noteTa.val(_notes[noteId]);
                    noteDial.dialog({
                        modal: true,
                        close: function(event, ui) {
                            _notes[noteId] = noteTa.val();
                        }
                    });
                },
                _deleteNote = function(noteId) {
                    delete _notes[noteId];
                },
                _saveNote = function(noteId) {
                    return _notes[noteId];
                },
                _loadNote = function(noteId, data) {
                    _notes[noteId] = data;
                };
                return {
                    showNote: _showNote,
                    deleteNote: _deleteNote,
                    saveNote: _saveNote,
                    loadNote: _loadNote
                }
            }
       }
});

}(jQuery));