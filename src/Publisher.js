/* @flow */
import * as _ from './utils';

export type UnsubscribeFunction = () => void;


/**
 * @constructor
 */
export default class Publisher {
    emitter            : any;
    _dispatchPromises  : Array< any >;


    /**
     * @protected
     */
    constructor() {
        this.emitter = new _.EventEmitter();
        this._dispatchPromises = [];
    }

    get eventType() : string { return 'event'; }
    get isPublisher() : boolean { return true; }


    /**
     * Hook used by the publisher that is invoked before emitting
     * and before `shouldEmit`. The arguments are the ones that the action
     * is invoked with. If this function returns something other than
     * undefined, that will be passed on as arguments for shouldEmit and
     * emission.
     */
    preEmit() : ?Object {}

    /**
     * Hook used by the publisher after `preEmit` to determine if the
     * event should be emitted with given arguments. This may be overridden
     * in your application, default implementation always returns true.
     *
     * @returns {Boolean} true if event should be emitted
     */
    shouldEmit() : boolean {
        return true;
    }

    /**
     * Subscribes the given callback for action triggered
     *
     * @param {Function} callback The callback to register as event handler
     * @param {Mixed} [optional] bindContext The context to bind the callback with
     * @returns {Function} Callback that unsubscribes the registered event handler
     */
    listen( callback: ( x: any ) => ?Promise ) : UnsubscribeFunction {
        var aborted = false;

        var eventHandler = ( args ) => {
            if( aborted ) return;

            const result : ?Promise = callback.apply( this, args );

            if (_.isPromise(result)) {
                // Note: To support mixins, we need to access the method this way.
                //   Overrides are not possible.
                //
                //  TODO: check if we still need this with classes/do we allow override ?
                const canHandlePromise : boolean = this.canHandlePromise();
                if( !canHandlePromise ) {
                    console.warn('Unhandled promise for ' + this.eventType);
                    return;
                }

                this._dispatchPromises.push({
                    promise : result,
                    listener: callback
                });
            }
        };
        this.emitter.addListener( this.eventType, eventHandler );

        return () => {
            aborted = true;
            this.emitter.removeListener( this.eventType, eventHandler );
        };
    }


    listenOnce( callback: Function, bindContext: any ) : Function {
        bindContext = bindContext || this;
        var unsubscribe = this.listen( () => {
            var args = Array.prototype.slice.call(arguments);
            unsubscribe();
            return callback.apply( bindContext, args );
        });
        return unsubscribe;
    }

    /**
     * Attach handlers to promise that trigger the completed and failed
     * child publishers, if available.
     *
     * @param {Object} The promise to attach to
     */
/*    promise( promise: Promise ) {
        var canHandlePromise : boolean =
            this.children.indexOf('completed') >= 0 &&
            this.children.indexOf('failed') >= 0;

        if( !canHandlePromise ){
            throw new Error('Publisher must have "completed" and "failed" child publishers');
        }

        promise.then( ( response ) => this.completed.asFunction( response ) )
               .catch( ( error ) => this.failed.asFunction( error ) );
    }*/


    /**
     * Publishes an event using `this.emitter` (if `shouldEmit` agrees)
     */
    triggerSync() {
        var args = arguments;
        var preResult = this.preEmit.apply( this, args );
        if( typeof preResult !== 'undefined' ) {
            args = _.isArguments(preResult) ? preResult : [].concat(preResult);
        }

        if( this.shouldEmit.apply( this, args ) ) {
            this._dispatchPromises = [];
            this.emitter.emit( this.eventType, args );

            this._handleDispatchPromises();
        }
    }

    /**
     * Tries to publish the event on the next tick
     */
    trigger() {
        const args = arguments;
        _.nextTick( () => this.triggerSync.apply( this, args ) );
    }

    /**
     * Attach handlers to promise that trigger the completed and failed
     * child publishers, if available.
     *
     * @param {Object} promise The result to use or a promise to which to listen.
     */
    resolve( promise: Promise ) {
        if( !_.isPromise( promise ) ) {
            this.completed.asFunction( promise );
            return;
        }

        return promise.then( ( response ) => this.completed.asFunction( response ), ( error ) => this.failed.asFunction( error ) );
    }

    /**
     * @private
     */
    _handleDispatchPromises() : ?Promise {
        var promises = this._dispatchPromises;
        this._dispatchPromises = [];

        if (promises.length === 0) {
            return;
        }
        if (promises.length === 1) {
            return this.resolve(promises[0].promise);
        }

        var mappedPromises = promises.map(function (item) {
            return item.promise.then( ( result ) => {
                return {
                    listener: item.listener,
                    value: result
                };
            });
        });

        var joinedPromise = Promise.all(mappedPromises);
        return this.resolve(joinedPromise);
    }
}
